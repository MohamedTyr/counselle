"""Importability and validation pins for workspace boundary models."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.workspace.models import (
    ApplicationCreate,
    ApplicationPatch,
    ChangeEvent,
    ChangeEventData,
    EssayCreate,
    TaskCreate,
    TaskPatch,
)


def test_workspace_models_import_and_validate_minimal_payloads() -> None:
    app = ApplicationCreate(unitid=166027, cycle_year=2027, list_type="Target", round="RD")
    task = TaskCreate(title="Request transcript")
    essay = EssayCreate(title="Supplemental essay")

    assert app.unitid == 166027
    assert task.status == "todo"
    assert essay.content["type"] == "doc"


def test_workspace_models_reject_unknown_enums() -> None:
    with pytest.raises(ValidationError):
        TaskCreate(title="Bad task", priority="urgent")  # type: ignore[arg-type]


def test_application_status_accepts_deferred_and_enrolled() -> None:
    assert ApplicationPatch(status="Deferred").status == "Deferred"
    assert ApplicationPatch(status="Enrolled").status == "Enrolled"


def test_round_accepts_ed2_and_rea_and_rejects_scholarship_deadline() -> None:
    assert ApplicationPatch(round="ED2").round == "ED2"
    assert ApplicationPatch(round="REA").round == "REA"
    with pytest.raises(ValidationError):
        ApplicationPatch(round="Scholarship deadline")  # type: ignore[arg-type]


def test_task_category_accepts_interview() -> None:
    assert TaskPatch(category="interview").category == "interview"


def test_application_patch_accepts_new_field_pass_fields() -> None:
    patch = ApplicationPatch(
        aid_deadline=None,
        scholarship_deadline=None,
        notes="Visited campus in June",
        intended_major="Computer Science",
        test_plan="withhold",
    )
    assert patch.notes == "Visited campus in June"
    assert patch.intended_major == "Computer Science"
    assert patch.test_plan == "withhold"
    with pytest.raises(ValidationError):
        ApplicationPatch(test_plan="maybe")  # type: ignore[arg-type]


def test_change_event_shape_matches_phase_1_contract() -> None:
    object_id = uuid4()
    event = ChangeEvent(
        id=12,
        type="task.created",
        data=ChangeEventData(
            object_type="task",
            object_id=object_id,
            op="created",
            actor="student",
        ),
    )

    assert event.model_dump(mode="json") == {
        "id": 12,
        "v": 1,
        "type": "task.created",
        "data": {
            "object_type": "task",
            "object_id": str(object_id),
            "op": "created",
            "actor": "student",
            "application_id": None,
        },
    }
