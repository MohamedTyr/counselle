"""Pydantic models for the MVP3 workspace service boundary."""

from __future__ import annotations

from copy import deepcopy
from datetime import date as Date
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    RootModel,
    StrictBool,
    field_validator,
    model_validator,
)

from domain.envelope import CitationEnvelope

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
Platform = Literal["common_app", "coalition", "school_portal", "direct", "other"]
Applicability = Literal["required", "optional", "not_required", "conditional", "unknown"]
ReferenceState = Literal["draft", "published", "retracted"]
TrackableRequirementKind = Literal["fee", "css_profile", "fafsa", "testing"]
TaskPriority = Literal["low", "med", "high"]
Assignee = Literal["student", "counselle"]
EssayStatus = Literal["Not started", "Drafting", "Needs review", "Ready", "Submitted"]
EssayType = Literal["Personal statement", "Supplement", "Scholarship", "Optional"]
ObjectType = Literal[
    "application",
    "task",
    "essay",
    "activity",
    "honor",
    "profile",
    "document",
    "memory",
]
ChangeOp = Literal["created", "updated", "archived", "restored"]

PROFILE_TEXT_MAX_LENGTH = 5_000
PROFILE_SHORT_TEXT_MAX_LENGTH = 500
MEMORY_CONTENT_MAX_LENGTH = 200
MEMORY_TOTAL_MAX_CHARS = 5_000
MEMORY_BATCH_MIN_ITEMS = 1
MEMORY_BATCH_MAX_ITEMS = 10
DOCUMENT_MAX_BYTES = 15 * 1024 * 1024
#: Cap on stored/returned extracted document text (truncated, not rejected, at
#: the extraction layer) — legitimate large PDFs/DOCX can otherwise yield
#: several MB of text stored and returned verbatim.
EXTRACTED_TEXT_MAX_LENGTH = 500_000

ProfileText = Annotated[str, Field(max_length=PROFILE_TEXT_MAX_LENGTH)]
ProfileShortText = Annotated[str, Field(max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)]
ProfileBoolean = StrictBool


def _parse_profile_decimal(value: object) -> Decimal:
    """Parse an entered decimal without accepting a lossy float representation."""
    if isinstance(value, bool):
        raise ValueError("profile decimal values cannot be boolean")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    if not isinstance(value, str):
        raise ValueError("profile decimal values must be submitted as decimal strings")
    try:
        return Decimal(value)
    except InvalidOperation as error:
        raise ValueError("profile decimal values must be valid decimal strings") from error


ProfileDecimal = Annotated[Decimal, BeforeValidator(_parse_profile_decimal)]

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


class ChecklistEntry(_Model):
    status: str = Field(min_length=1, max_length=32)
    updated_at: datetime | None = None


_CHECKLIST_STATUSES: dict[str, frozenset[str]] = {
    "fee": frozenset({"not_started", "to_do", "waiver_requested", "paid"}),
    "css_profile": frozenset({"not_started", "in_progress", "submitted"}),
    "fafsa": frozenset({"not_started", "in_progress", "submitted"}),
    "testing": frozenset({"not_started", "in_progress", "submitted"}),
}


class ChecklistPatch(RootModel[dict[TrackableRequirementKind, ChecklistEntry | None]]):
    """Atomic shallow patch; JSON null deletes one tracked key."""

    @field_validator("root")
    @classmethod
    def validate_statuses(
        cls, value: dict[TrackableRequirementKind, ChecklistEntry | None]
    ) -> dict[TrackableRequirementKind, ChecklistEntry | None]:
        for key, entry in value.items():
            if entry is not None and entry.status not in _CHECKLIST_STATUSES[key]:
                raise ValueError(f"invalid checklist status for {key}")
        return value


class ChecklistMap(RootModel[dict[TrackableRequirementKind, ChecklistEntry]]):
    @field_validator("root")
    @classmethod
    def validate_statuses(
        cls, value: dict[TrackableRequirementKind, ChecklistEntry]
    ) -> dict[TrackableRequirementKind, ChecklistEntry]:
        ChecklistPatch(root=value)
        return value


class Application(_Model):
    id: UUID
    user_id: UUID
    school_unitid: int
    status: ApplicationStatus
    list_type: ListType
    round: Round
    deadline: Date | None = None
    aid_deadline: Date | None = None
    scholarship_deadline: Date | None = None
    notes: str | None = None
    intended_major: str | None = None
    test_plan: TestPlan | None = None
    cycle_year: int | None = Field(default=None, ge=2000, le=2200)
    checklist: ChecklistMap = Field(default_factory=lambda: ChecklistMap(root={}))
    platform: Platform | None = None
    platform_other: str | None = None
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
    active_cycle_years: list[int] = Field(default_factory=list)
    has_legacy_application: bool = False


class ApplicationCreate(_Model):
    unitid: int
    cycle_year: int = Field(ge=2000, le=2200)
    list_type: ListType
    round: Round
    deadline: Date | None = None


class ApplicationPatch(_Model):
    status: ApplicationStatus | None = None
    list_type: ListType | None = None
    round: Round | None = None
    deadline: Date | None = None
    aid_deadline: Date | None = None
    scholarship_deadline: Date | None = None
    notes: str | None = None
    intended_major: str | None = None
    test_plan: TestPlan | None = None
    cycle_year: int | None = Field(default=None, ge=2000, le=2200)
    checklist: ChecklistPatch | None = None
    platform: Platform | None = None
    platform_other: str | None = None

    @field_validator(
        "status", "list_type", "round", "cycle_year", "checklist", mode="before"
    )
    @classmethod
    def reject_null_required_fields(cls, value: object) -> object:
        if value is None:
            raise ValueError("field may be omitted but cannot be null")
        return value

    @model_validator(mode="after")
    def validate_platform_other(self) -> ApplicationPatch:
        # The service validates the combined persisted + patch state while
        # holding the application row lock. A partial patch cannot be judged
        # correctly from request fields alone.
        return self


class Task(_Model):
    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    essay_id: UUID | None = None
    requirement_kind: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,63}$")
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
    requirement_kind: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,63}$")
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
    requirement_kind: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,63}$")
    notes: str | None = None
    status: TaskStatus | None = None
    category: TaskCategory | None = None
    priority: TaskPriority | None = None
    assignee: Assignee | None = None
    needs_input: bool | None = None
    due_at: datetime | None = None
    planned_for: datetime | None = None
    reminder_at: datetime | None = None

    @field_validator(
        "title", "status", "category", "priority", "assignee", "needs_input", mode="before"
    )
    @classmethod
    def reject_null_required_fields(cls, value: object) -> object:
        if value is None:
            raise ValueError("field may be omitted but cannot be null")
        return value


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


class ApplicationAddResult(_Model):
    application: ApplicationView


class Essay(_Model):
    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    prompt_ref: UUID | None = None
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
    deadline: Date | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class EssaySummary(_Model):
    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    prompt_ref: UUID | None = None
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
    deadline: Date | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class EssayCreate(_Model):
    title: str
    application_id: UUID | None = None
    prompt_ref: UUID | None = None
    essay_type: EssayType = "Supplement"
    status: EssayStatus = "Not started"
    prompt: str | None = None
    content: dict[str, Any] = Field(default_factory=lambda: deepcopy(EMPTY_TIPTAP_DOC))
    word_limit: int | None = None


class EssayPatch(_Model):
    title: str | None = None
    application_id: UUID | None = None
    prompt_ref: UUID | None = None
    essay_type: EssayType | None = None
    status: EssayStatus | None = None
    prompt: str | None = None
    content: dict[str, Any] | None = None
    word_limit: int | None = None
    deadline: Date | None = None
    expected_updated_at: datetime | None = None

    @field_validator("title", "essay_type", "status", "content", mode="before")
    @classmethod
    def reject_null_required_fields(cls, value: object) -> object:
        if value is None:
            raise ValueError("field may be omitted but cannot be null")
        return value


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


class _ProfileModel(_Model):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="forbid")


class HighSchool(_ProfileModel):
    name: ProfileShortText | None = None
    type: (
        Literal[
            "public",
            "charter",
            "magnet",
            "private",
            "parochial",
            "homeschool",
            "international",
        ]
        | None
    ) = None
    city: ProfileShortText | None = None
    state: ProfileShortText | None = None
    country: ProfileShortText | None = None


class Basics(_ProfileModel):
    preferred_name: ProfileShortText | None = None
    pronouns: ProfileShortText | None = None
    grade_level: Literal["9", "10", "11", "12", "gap", "other"] | None = None
    graduation_year: int | None = Field(default=None, ge=2000, le=2100)
    high_school: HighSchool | None = None
    notes: ProfileText | None = None


class GradeTrend(_ProfileModel):
    trend: Literal["upward", "flat", "dip"] | None = None
    why: ProfileText | None = None


class Academics(_ProfileModel):
    gpa_unweighted: ProfileDecimal | None = Field(default=None, ge=0)
    gpa_weighted: ProfileDecimal | None = Field(default=None, ge=0)
    gpa_scale: ProfileDecimal | None = Field(default=None, gt=0)
    class_rank: int | None = Field(default=None, ge=1)
    class_size: int | None = Field(default=None, ge=1)
    school_ranks: ProfileBoolean | None = None
    grade_trend: GradeTrend | None = None
    current_courses: list[ProfileShortText] | None = Field(default=None, max_length=30)
    rigor_summary: ProfileText | None = None
    notes: ProfileText | None = None

    @model_validator(mode="after")
    def _check_coherence(self) -> Academics:
        if (
            self.gpa_unweighted is not None
            and self.gpa_scale is not None
            and self.gpa_unweighted > self.gpa_scale
        ):
            raise ValueError("unweighted GPA cannot exceed its scale")
        if (
            self.class_rank is not None
            and self.class_size is not None
            and self.class_rank > self.class_size
        ):
            raise ValueError("class rank cannot exceed class size")
        return self


class SatScore(_ProfileModel):
    total: int | None = Field(default=None, ge=400, le=1600)
    ebrw: int | None = Field(default=None, ge=200, le=800)
    math: int | None = Field(default=None, ge=200, le=800)
    date: Date | None = None

    @model_validator(mode="after")
    def _check_total(self) -> SatScore:
        if (
            self.total is not None
            and self.ebrw is not None
            and self.math is not None
            and self.total != self.ebrw + self.math
        ):
            raise ValueError("SAT total must equal EBRW plus math")
        return self


class ActScore(_ProfileModel):
    composite: int | None = Field(default=None, ge=1, le=36)
    sections: dict[str, ProfileDecimal] | None = None
    date: Date | None = None


class PlannedTest(_ProfileModel):
    test: ProfileShortText
    date: Date | None = None


class PsatScore(_ProfileModel):
    total: int | None = Field(default=None, ge=320, le=1520)
    nmsqt_status: ProfileShortText | None = None


class ApScore(_ProfileModel):
    subject: ProfileShortText
    score: int = Field(ge=1, le=5)


class IbScore(_ProfileModel):
    programme: ProfileShortText | None = None
    predicted: ProfileDecimal | None = Field(default=None, ge=0, le=45)
    final: ProfileDecimal | None = Field(default=None, ge=0, le=45)


class EnglishProficiency(_ProfileModel):
    test: ProfileShortText | None = None
    score: ProfileShortText | None = None
    date: Date | None = None


class Testing(_ProfileModel):
    sat: SatScore | None = None
    act: ActScore | None = None
    planned_tests: list[PlannedTest] | None = Field(default=None, max_length=10)
    psat: PsatScore | None = None
    ap_scores: list[ApScore] | None = Field(default=None, max_length=30)
    ib: IbScore | None = None
    english_proficiency: EnglishProficiency | None = None
    notes: ProfileText | None = None


class Residence(_ProfileModel):
    city: ProfileShortText | None = None
    state: ProfileShortText | None = None
    country: ProfileShortText | None = None


class Hook(_ProfileModel):
    kind: Literal[
        "legacy",
        "recruited_athlete",
        "development",
        "faculty_child",
        "tribal",
        "military_family",
        "questbridge_posse",
        "other",
    ]
    detail: ProfileText | None = None


class Background(_ProfileModel):
    citizenship: ProfileShortText | None = None
    visa_status: ProfileShortText | None = None
    residence: Residence | None = None
    first_gen: ProfileBoolean | None = None
    family_education: ProfileText | None = None
    hooks: list[Hook] | None = Field(default=None, max_length=10)
    languages: list[ProfileShortText] | None = Field(default=None, max_length=20)
    community_type: Literal["rural", "small_town", "suburban", "urban"] | None = None
    notes: ProfileText | None = None


class Circumstances(_ProfileModel):
    disruptions: ProfileText | None = None
    responsibilities: ProfileText | None = None
    health_learning: ProfileText | None = None
    disciplinary: ProfileText | None = None
    notes: ProfileText | None = None


class Aid(_ProfileModel):
    need_aid: ProfileBoolean | None = None
    budget_per_year: ProfileDecimal | None = Field(default=None, ge=0)
    sai_estimate: ProfileDecimal | None = None
    css_complexity: ProfileText | None = None
    loan_appetite: Literal["none", "limited", "open"] | None = None
    merit_priority: ProfileBoolean | None = None
    applying_for_scholarships: ProfileBoolean | None = None
    notes: ProfileText | None = None


class Interests(_ProfileModel):
    intended_majors: list[ProfileShortText] | None = Field(default=None, max_length=10)
    major_certainty: Literal["locked", "leaning", "exploring"] | None = None
    alternate_majors: list[ProfileShortText] | None = Field(default=None, max_length=10)
    career_direction: ProfileText | None = None
    preprofessional: (
        list[
            Literal["pre_med", "pre_law", "bs_md", "nursing", "engineering_accreditation", "other"]
        ]
        | None
    ) = Field(default=None, max_length=10)
    notes: ProfileText | None = None


class Preferences(_ProfileModel):
    sizes: list[Literal["small", "medium", "large"]] | None = Field(default=None, max_length=3)
    settings: list[Literal["urban", "suburban", "college_town", "rural"]] | None = Field(
        default=None, max_length=4
    )
    regions: list[ProfileShortText] | None = Field(default=None, max_length=20)
    max_distance_from_home: ProfileShortText | None = None
    climate: ProfileShortText | None = None
    campus_culture: ProfileText | None = None
    must_haves: list[ProfileShortText] | None = Field(default=None, max_length=30)
    dealbreakers: list[ProfileShortText] | None = Field(default=None, max_length=30)
    notes: ProfileText | None = None


class Narrative(_ProfileModel):
    spike: ProfileText | None = None
    defining_experiences: ProfileText | None = None
    self_description: ProfileText | None = None
    values_motivations: ProfileText | None = None
    essay_angles: ProfileText | None = None
    notes: ProfileText | None = None


class Recommender(_ProfileModel):
    name: ProfileShortText
    role_or_subject: ProfileShortText | None = None
    why_them: ProfileText | None = None
    asked: ProfileBoolean | None = None


class People(_ProfileModel):
    recommenders: list[Recommender] | None = Field(default=None, max_length=10)
    counselor_context: ProfileText | None = None
    family_stance: ProfileText | None = None
    other_support: ProfileText | None = None
    notes: ProfileText | None = None


class Profile(_ProfileModel):
    basics: Basics | None = None
    academics: Academics | None = None
    testing: Testing | None = None
    background: Background | None = None
    circumstances: Circumstances | None = None
    aid: Aid | None = None
    interests: Interests | None = None
    preferences: Preferences | None = None
    narrative: Narrative | None = None
    people: People | None = None


class ProfilePatch(Profile):
    """Section-level JSON merge patch; unset fields are retained, nulls clear."""


DocumentType = Literal[
    "transcript",
    "resume",
    "essay",
    "recommendation",
    "award",
    "school_report",
    "other",
]
DocumentTextStatus = Literal["extracted", "unsupported", "failed"]


class Document(_Model):
    id: UUID
    user_id: UUID
    title: str = Field(max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    doc_type: DocumentType
    filename: str = Field(max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    mime: str = Field(max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    size_bytes: int = Field(ge=0)
    text_status: DocumentTextStatus
    summary: str | None = Field(default=None, max_length=PROFILE_TEXT_MAX_LENGTH)
    created_at: datetime
    archived_at: datetime | None = None


class DocumentContent(Document):
    content: bytes
    extracted_text: str | None = Field(default=None, max_length=EXTRACTED_TEXT_MAX_LENGTH)


class DocumentCreate(_Model):
    title: str = Field(max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    doc_type: DocumentType = "other"
    filename: str = Field(max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    mime: str = Field(max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    content: bytes
    text_status: DocumentTextStatus
    extracted_text: str | None = Field(default=None, max_length=EXTRACTED_TEXT_MAX_LENGTH)
    summary: str | None = Field(default=None, max_length=PROFILE_TEXT_MAX_LENGTH)


class DocumentUpload(_Model):
    """Student-supplied upload data before extraction and summarization."""

    title: str = Field(min_length=1, max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    doc_type: DocumentType = "other"
    filename: str = Field(min_length=1, max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    mime: str = Field(min_length=1, max_length=PROFILE_SHORT_TEXT_MAX_LENGTH)
    content: bytes = Field(min_length=1, max_length=DOCUMENT_MAX_BYTES)


class Memory(_Model):
    id: UUID
    user_id: UUID
    content: str = Field(min_length=1, max_length=MEMORY_CONTENT_MAX_LENGTH)
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class MemoryCreate(_Model):
    content: str = Field(min_length=1, max_length=MEMORY_CONTENT_MAX_LENGTH)


class MemoryPatch(_Model):
    content: str = Field(min_length=1, max_length=MEMORY_CONTENT_MAX_LENGTH)


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


def _https_source_url(value: str) -> str:
    from urllib.parse import urlsplit

    if any(character.isspace() for character in value):
        raise ValueError("source_url must not contain whitespace")
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("source_url must be an absolute HTTPS URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("source_url must not contain credentials")
    return value


HttpsSourceUrl = Annotated[str, AfterValidator(_https_source_url)]


class ReferenceProvenance(_Model):
    source: str = Field(min_length=1)
    source_url: HttpsSourceUrl
    verified_at: Date
    published_at: datetime


class SchoolPromptGroup(_Model):
    id: UUID
    school_unitid: int
    cycle_year: int
    label: str
    choice_min: int = Field(gt=0)
    provenance: ReferenceProvenance


class SchoolEssayPrompt(_Model):
    id: UUID
    school_unitid: int
    cycle_year: int
    ordinal: int = Field(gt=0)
    prompt: str = Field(min_length=1)
    word_limit: int | None = Field(default=None, gt=0)
    applicability: Applicability
    audience: dict[str, Any] = Field(default_factory=dict)
    group_id: UUID | None = None
    provenance: ReferenceProvenance


class FeeRequirementDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount_cents: Annotated[int, Field(strict=True, ge=0)] | None = None
    waiver_available: StrictBool | None = None


class RecommendationRequirementDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    count: Annotated[int, Field(strict=True, ge=0)] | None = None


class FormRequirementDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    form_name: str | None = Field(default=None, min_length=1)
    form_url: str | None = Field(default=None, pattern=r"^https://")
    deadline: Date | None = None


class TestingRequirementDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy: Literal["required", "optional", "blind", "flexible", "unknown"] | None = None
    notes: str | None = Field(default=None, min_length=1)


class AidRequirementDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    form_name: str | None = Field(default=None, min_length=1)
    deadline: Date | None = None
    notes: str | None = Field(default=None, min_length=1)


class SchoolRequirement(_Model):
    id: UUID
    school_unitid: int
    cycle_year: int
    kind: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    label: str = Field(min_length=1)
    applicability: Applicability
    audience: dict[str, Any] = Field(default_factory=dict)
    detail: dict[str, Any] = Field(default_factory=dict)
    provenance: ReferenceProvenance

    @model_validator(mode="after")
    def validate_known_detail(self) -> SchoolRequirement:
        if self.kind == "fee":
            FeeRequirementDetail.model_validate(self.detail)
        elif self.kind in {"teacher_rec", "counselor_rec"}:
            RecommendationRequirementDetail.model_validate(self.detail)
        elif self.kind == "form":
            FormRequirementDetail.model_validate(self.detail)
        elif self.kind == "testing":
            TestingRequirementDetail.model_validate(self.detail)
        elif self.kind in {"aid", "css_profile", "fafsa"}:
            AidRequirementDetail.model_validate(self.detail)
        return self


class SchoolReference(_Model):
    status: Literal["cycle_required", "loaded"]
    cycle_year: int | None
    populated: bool = False
    prompt_groups: list[SchoolPromptGroup] = Field(default_factory=list)
    prompts: list[SchoolEssayPrompt] = Field(default_factory=list)
    requirements: list[SchoolRequirement] = Field(default_factory=list)
    test_policy: CitationEnvelope | None = None


class ApplicationDetail(_Model):
    application: ApplicationView
    tasks: list[Task]
    essays: list[EssaySummary]
    reference: SchoolReference
