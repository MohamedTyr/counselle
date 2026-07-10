"""Pydantic models for the MVP3 workspace service boundary."""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Actor = Literal["student", "counselle"]
ApplicationStatus = Literal[
    "Considering",
    "Applying",
    "Submitted",
    "Deferred",
    "Accepted",
    "Enrolled",
    "Rejected",
    "Waitlisted",
    "Withdrawn",
]
ListType = Literal["Reach", "Target", "Safety"]
Round = Literal["EA", "ED", "ED2", "REA", "RD", "Rolling", "Priority"]
TaskStatus = Literal["todo", "doing", "waiting", "done"]
TaskCategory = Literal["essay", "lor", "aid", "research", "other", "form", "interview"]
TestPlan = Literal["submit", "withhold", "undecided"]
TaskPriority = Literal["low", "med", "high"]
Assignee = Literal["student", "counselle"]
EssayStatus = Literal["Not started", "Drafting", "Needs review", "Ready", "Submitted"]
EssayType = Literal["Personal statement", "Supplement", "Scholarship", "Optional"]
ObjectType = Literal["application", "task", "essay", "activity", "honor"]
ChangeOp = Literal["created", "updated", "archived", "restored"]

EMPTY_TIPTAP_DOC: dict[str, Any] = {"type": "doc", "content": [{"type": "paragraph"}]}


class WorkspaceNotFoundError(Exception):
    """Raised when a workspace row is missing or belongs to another user."""


class WorkspaceValidationError(Exception):
    """Raised when workspace input is structurally valid but conflicts with state."""


class ActivityDuplicateError(WorkspaceValidationError):
    """Raised when an agent batch repeats an active activity identity."""

    def __init__(
        self,
        *,
        duplicate_index: int,
        active_activity_id: UUID | None = None,
        earlier_batch_index: int | None = None,
    ) -> None:
        super().__init__("duplicate activity")
        self.duplicate_index = duplicate_index
        self.active_activity_id = active_activity_id
        self.earlier_batch_index = earlier_batch_index


class _Model(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class Application(_Model):
    id: UUID
    user_id: UUID
    school_unitid: int
    status: ApplicationStatus
    list_type: ListType
    round: Round
    deadline: date | None = None
    aid_deadline: date | None = None
    scholarship_deadline: date | None = None
    notes: str | None = None
    intended_major: str | None = None
    test_plan: TestPlan | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class Rollup(_Model):
    completed: int
    total: int


class ApplicationView(Application):
    school_name: str
    school_city: str | None = None
    school_state: str | None = None
    website_url: str | None = None
    progress: Rollup
    essays: Rollup


class SchoolSearchResult(_Model):
    unitid: int
    name: str
    city: str | None = None
    state: str | None = None
    website_url: str | None = None
    on_list: bool = False


class ApplicationCreate(_Model):
    unitid: int
    list_type: ListType
    round: Round
    deadline: date | None = None


class ApplicationPatch(_Model):
    status: ApplicationStatus | None = None
    list_type: ListType | None = None
    round: Round | None = None
    deadline: date | None = None
    aid_deadline: date | None = None
    scholarship_deadline: date | None = None
    notes: str | None = None
    intended_major: str | None = None
    test_plan: TestPlan | None = None


class Task(_Model):
    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    essay_id: UUID | None = None
    title: str
    notes: str | None = None
    status: TaskStatus
    category: TaskCategory
    priority: TaskPriority
    assignee: Assignee
    needs_input: bool = False
    due_at: datetime | None = None
    planned_for: datetime | None = None
    reminder_at: datetime | None = None
    completed_at: datetime | None = None
    archived_via_application: UUID | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class TaskCreate(_Model):
    title: str
    application_id: UUID | None = None
    essay_id: UUID | None = None
    notes: str | None = None
    status: TaskStatus = "todo"
    category: TaskCategory = "other"
    priority: TaskPriority = "med"
    assignee: Assignee = "student"
    needs_input: bool = False
    due_at: datetime | None = None
    planned_for: datetime | None = None
    reminder_at: datetime | None = None


class TaskPatch(_Model):
    title: str | None = None
    application_id: UUID | None = None
    essay_id: UUID | None = None
    notes: str | None = None
    status: TaskStatus | None = None
    category: TaskCategory | None = None
    priority: TaskPriority | None = None
    assignee: Assignee | None = None
    needs_input: bool | None = None
    due_at: datetime | None = None
    planned_for: datetime | None = None
    reminder_at: datetime | None = None


class TaskSearchHit(_Model):
    """One `search_tasks` result row (Locked decision 4 / 9: FTS+trgm, archived included)."""

    id: UUID
    title: str
    status: TaskStatus
    category: TaskCategory
    state: Literal["active", "done", "archived"]
    match: str | None = None
    archived_at: datetime | None = None


class TaskBoardCounts(_Model):
    """Aggregate counts for the view_tasks/search_tasks footer (Phase 3 formats wording)."""

    done: int
    done_recent: int
    archived: int


class SeededWorkspaceIds(_Model):
    task_ids: list[UUID]
    essay_ids: list[UUID]


class ApplicationAddResult(_Model):
    application: ApplicationView
    seeded: SeededWorkspaceIds


class Essay(_Model):
    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    title: str
    essay_type: EssayType
    status: EssayStatus
    prompt: str | None = None
    content: dict[str, Any] = Field(default_factory=lambda: deepcopy(EMPTY_TIPTAP_DOC))
    word_count: int = 0
    word_limit: int | None = None
    comments: list[dict[str, Any]] = Field(default_factory=list)
    suggestions: list[dict[str, Any]] = Field(default_factory=list)
    archived_via_application: UUID | None = None
    school_name: str | None = None
    school_city: str | None = None
    school_state: str | None = None
    deadline: date | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class EssaySummary(_Model):
    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    title: str
    essay_type: EssayType
    status: EssayStatus
    prompt: str | None = None
    preview: str
    word_count: int = 0
    word_limit: int | None = None
    comment_count: int = 0
    suggestion_count: int = 0
    archived_via_application: UUID | None = None
    school_name: str | None = None
    school_city: str | None = None
    school_state: str | None = None
    deadline: date | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class EssayCreate(_Model):
    title: str
    application_id: UUID | None = None
    essay_type: EssayType = "Supplement"
    status: EssayStatus = "Not started"
    prompt: str | None = None
    content: dict[str, Any] = Field(default_factory=lambda: deepcopy(EMPTY_TIPTAP_DOC))
    word_limit: int | None = None


class EssayPatch(_Model):
    title: str | None = None
    application_id: UUID | None = None
    essay_type: EssayType | None = None
    status: EssayStatus | None = None
    prompt: str | None = None
    content: dict[str, Any] | None = None
    word_limit: int | None = None
    deadline: date | None = None
    expected_updated_at: datetime | None = None


class Activity(_Model):
    id: UUID
    user_id: UUID
    sort_order: int
    activity_type: str = ""
    position: str = Field(default="", alias="position_label")
    organization: str = ""
    description: str = ""
    grades: list[str] = Field(default_factory=list)
    timing: list[str] = Field(default_factory=list)
    hours_per_week: float | None = None
    weeks_per_year: float | None = None
    continue_in_college: bool | None = None
    story: str | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class ActivityCreate(_Model):
    activity_type: str = ""
    position: str = ""
    organization: str = ""
    description: str = ""
    grades: list[str] = Field(default_factory=list)
    timing: list[str] = Field(default_factory=list)
    hours_per_week: float | None = None
    weeks_per_year: float | None = None
    continue_in_college: bool | None = None
    story: str | None = None


class ActivityPatch(_Model):
    activity_type: str | None = None
    position: str | None = None
    organization: str | None = None
    description: str | None = None
    grades: list[str] | None = None
    timing: list[str] | None = None
    hours_per_week: float | None = None
    weeks_per_year: float | None = None
    continue_in_college: bool | None = None
    story: str | None = None


class Honor(_Model):
    id: UUID
    user_id: UUID
    sort_order: int
    title: str = ""
    grades: list[str] = Field(default_factory=list)
    levels: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class HonorCreate(_Model):
    title: str = ""
    grades: list[str] = Field(default_factory=list)
    levels: list[str] = Field(default_factory=list)


class HonorPatch(_Model):
    title: str | None = None
    grades: list[str] | None = None
    levels: list[str] | None = None


class ChangeEventData(_Model):
    object_type: ObjectType
    object_id: UUID
    op: ChangeOp
    actor: Actor
    application_id: UUID | None = None


class ChangeEvent(_Model):
    id: int
    v: Literal[1] = 1
    type: str
    data: ChangeEventData


class ApplicationDetail(_Model):
    application: ApplicationView
    tasks: list[Task]
    essays: list[EssaySummary]


class WorkspaceSeedTask(_Model):
    title: str
    category: TaskCategory
    priority: TaskPriority
    days_before_deadline: int | None = None


class WorkspaceSeedEssay(_Model):
    title: str
    essay_type: EssayType
    status: EssayStatus


class WorkspaceSeedingTemplate(_Model):
    tasks: list[WorkspaceSeedTask]
    essays: list[WorkspaceSeedEssay]
