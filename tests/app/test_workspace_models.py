"""Importability and validation pins for workspace boundary models."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.workspace.models import (
    ApplicationCreate,
    ChangeEvent,
    ChangeEventData,
    EssayCreate,
    TaskCreate,
)
from config.settings import load_yaml_asset


def test_workspace_models_import_and_validate_minimal_payloads() -> None:
    app = ApplicationCreate(unitid=166027, list_type="Target", round="RD")
    task = TaskCreate(title="Request transcript")
    essay = EssayCreate(title="Supplemental essay")

    assert app.unitid == 166027
    assert task.status == "todo"
    assert essay.content["type"] == "doc"


def test_workspace_models_reject_unknown_enums() -> None:
    with pytest.raises(ValidationError):
        TaskCreate(title="Bad task", priority="urgent")  # type: ignore[arg-type]


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


def test_workspace_seeding_asset_loads_and_validates() -> None:
    from app.workspace.models import WorkspaceSeedingTemplate

    template = WorkspaceSeedingTemplate.model_validate(load_yaml_asset("workspace_seeding"))

    assert [task.title for task in template.tasks] == [
        "Complete the Common App sections for this school",
        "Request recommendation letters",
        "Request transcript from your school",
        "Send test scores (if you're submitting them)",
        "Research program + confirm application requirements",
        "Final review before submitting",
    ]
    assert template.tasks[-1].days_before_deadline == 3
    assert len(template.essays) == 1
    assert template.essays[0].essay_type == "Supplement"
