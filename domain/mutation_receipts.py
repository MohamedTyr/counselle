"""Public mutation-receipt contract (agent mutation receipts plan, §6).

One versioned envelope (:class:`WorkspaceMutationReceipt`) plus a discriminated
body union covers all 29 workspace/memory mutation tools. Everything here is
``extra="forbid", frozen=True`` — the receipt is a public, student-safe seam;
nothing here may carry raw tool arguments, SQL, secrets, or untrusted ids.

Construction is owned by ``app/workspace_mutation_receipts.py`` builders, which
apply the size/omission bounds in §6.6 before a model is ever built. The models
in this file validate *shape and internal consistency* (family/action/body
compatibility, batch accounting, truncation-flag honesty) — they do not know
about the byte-budget reduction strategy.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MutationFamily = Literal[
    "task", "school", "essay", "essay_content", "activity", "honor", "profile", "memory"
]

MutationAction = Literal[
    "create",
    "update",
    "archive",
    "restore",
    "duplicate",
    "reorder",
    "edit",
    "write",
    "remember",
    "update_memory",
    "forget",
]

MutationOutcome = Literal["success", "no_change", "partial", "failed", "unknown"]

MutationBodyKind = Literal[
    "batch",
    "update",
    "state_transition",
    "duplicate",
    "reorder",
    "essay_edit",
    "essay_write",
    "profile",
    "memory",
    "unresolved",
]

#: Field keys allowlisted per family (§6.3). Unknown keys reject construction —
#: there is no silent fallback to an unrestricted string.
TaskFieldKey = Literal[
    "title", "notes", "status", "category", "priority", "assignee",
    "needs_input", "due_at", "planned_for", "reminder_at",
    "application_id", "essay_id",
]
SchoolFieldKey = Literal[
    "list_type", "application_status", "round", "deadline", "aid_deadline",
    "scholarship_deadline", "test_plan", "intended_major", "notes",
]
EssayFieldKey = Literal[
    "title", "school", "type", "status", "word_limit", "deadline", "prompt", "prompt_link",
]
ActivityFieldKey = Literal[
    "position", "organization", "type", "grades", "timing", "hours_per_week",
    "weeks_per_year", "continuation", "rank", "description", "story",
]
HonorFieldKey = Literal["title", "grades", "recognition_level", "rank"]
ProfileFieldKey = str  # validated against PROFILE_EXACT_PATHS/PROFILE_CHANGED_ONLY_PATHS

FieldKey = TaskFieldKey | SchoolFieldKey | EssayFieldKey | ActivityFieldKey | HonorFieldKey | str


class BoundedDisplayText(BaseModel):
    """User-authored display text with an explicit, honest truncation fact.

    The real grapheme-cluster truncation (Unicode-correct: combining marks,
    ZWJ emoji sequences) happens in ``app.workspace_mutation_receipts`` —
    ADR 0017 keeps ``domain/`` to stdlib + pydantic only, so this model
    validates the cross-field invariant using a stdlib code-point count. That
    is a *conservative* stand-in: truncation always removes whole grapheme
    clusters, each spanning >=1 code point, so a truncated text's code-point
    length never exceeds its true (smaller) grapheme-cluster count minus what
    was cut — the inequality below still catches a genuinely contradictory
    receipt without needing real segmentation here.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str
    truncated: bool = False
    original_graphemes: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _truncation_consistency(self) -> BoundedDisplayText:
        if self.truncated:
            if self.original_graphemes is None or self.original_graphemes <= len(self.text):
                raise ValueError(
                    "truncated=True requires original_graphemes to exceed the serialized "
                    "text's length"
                )
        elif self.original_graphemes is not None:
            raise ValueError("truncated=False forbids a contradictory original_graphemes")
        return self


class MutationSubject(BaseModel):
    """A server-resolved subject identity — never a raw tool-input echo."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    title: BoundedDisplayText
    resource_ref: str | None = None  # UUID string; validated by the builder


MutationValueKind = Literal[
    "text", "enum", "enum_list", "text_list", "reference", "reference_list",
    "date", "datetime", "integer", "decimal", "boolean", "count", "word_budget",
]

_MAX_LIST_ITEMS = 20


class MutationValue(BaseModel):
    """A discriminated typed value crossing the receipt seam (§6.3)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: MutationValueKind
    text: BoundedDisplayText | None = None
    enum: str | None = None
    list_items: tuple[str, ...] | None = Field(default=None, max_length=_MAX_LIST_ITEMS)
    reference: MutationSubject | None = None
    reference_list: tuple[MutationSubject, ...] | None = Field(
        default=None, max_length=_MAX_LIST_ITEMS
    )
    date: str | None = None
    datetime: str | None = None
    integer: int | None = None
    decimal: str | None = None
    boolean: bool | None = None
    count: int | None = Field(default=None, ge=0)
    word_budget_used: int | None = Field(default=None, ge=0)
    word_budget_limit: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _payload_matches_kind(self) -> MutationValue:
        required = {
            "text": ("text",),
            "enum": ("enum",),
            "enum_list": ("list_items",),
            "text_list": ("list_items",),
            "reference": ("reference",),
            "reference_list": ("reference_list",),
            "date": ("date",),
            "datetime": ("datetime",),
            "integer": ("integer",),
            "decimal": ("decimal",),
            "boolean": ("boolean",),
            "count": ("count",),
            "word_budget": ("word_budget_used",),
        }[self.kind]
        for field_name in required:
            if getattr(self, field_name) is None:
                raise ValueError(f"kind={self.kind!r} requires {field_name!r}")
        return self


MutationChangeOperation = Literal["set", "clear", "replace", "delete", "move", "state_only"]


class MutationChange(BaseModel):
    """One typed field change inside an update/profile body."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    field_key: str
    operation: MutationChangeOperation
    before: MutationValue | None = None
    after: MutationValue | None = None

    @model_validator(mode="after")
    def _operation_shape(self) -> MutationChange:
        if self.operation == "set" and self.after is None:
            raise ValueError("operation='set' requires after")
        has_value = self.before is not None or self.after is not None
        if self.operation in ("clear", "delete") and has_value:
            # clear/delete render fixed frontend copy; no magic display string.
            raise ValueError(f"operation={self.operation!r} must not carry before/after values")
        if self.operation == "replace" and self.after is None:
            raise ValueError("operation='replace' requires after")
        if self.operation == "move" and (self.before is None or self.after is None):
            raise ValueError("operation='move' requires typed before/after ranks")
        if self.operation == "state_only" and (self.before is not None or self.after is not None):
            raise ValueError("operation='state_only' carries no value")
        return self


class MutationNotice(BaseModel):
    """A non-error informational/warning fact (§6.5). Never used for errors."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["info", "warning"]
    code: str = Field(pattern=r"^[a-z0-9_-]{1,64}$")
    message: BoundedDisplayText


ItemDisposition = Literal["changed", "unchanged", "skipped", "failed", "not_attempted", "unknown"]


class MutationItem(BaseModel):
    """Per-requested-input-position disposition for a batch (§6.4)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input_index: int = Field(ge=0)
    disposition: ItemDisposition
    subject: MutationSubject | None = None
    reason: BoundedDisplayText | None = None
    recovery: BoundedDisplayText | None = None


class MutationOmissions(BaseModel):
    """Exact counts of detail removed under size pressure (§6.6). Never vague."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    subjects: int = Field(default=0, ge=0)
    changes: int = Field(default=0, ge=0)
    item_details: int = Field(default=0, ge=0)
    notices: int = Field(default=0, ge=0)
    edit_operations: int = Field(default=0, ge=0)


# ---------------------------------------------------------------------------
# Body variants
# ---------------------------------------------------------------------------


class BatchMutationBody(BaseModel):
    """Every requested input position, its disposition, and derived counts."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["batch"] = "batch"
    items: tuple[MutationItem, ...] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def _contiguous_unique_indices(self) -> BatchMutationBody:
        indices = sorted(item.input_index for item in self.items)
        if indices != list(range(len(self.items))):
            raise ValueError("items must have contiguous, unique input_index values from 0")
        return self

    @property
    def changed_count(self) -> int:
        return sum(1 for item in self.items if item.disposition == "changed")

    @property
    def total_count(self) -> int:
        return len(self.items)


class UpdateMutationBody(BaseModel):
    """One subject plus its typed field changes."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["update"] = "update"
    subject: MutationSubject
    changes: tuple[MutationChange, ...] = Field(min_length=1, max_length=20)


StateTransitionState = Literal["created", "restored", "archived"]


class StateTransitionMutationBody(BaseModel):
    """create/archive/restore state with subject(s) and an optional cascade fact."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["state_transition"] = "state_transition"
    state: StateTransitionState
    subjects: tuple[MutationSubject, ...] = Field(min_length=1, max_length=20)
    cascade: MutationNotice | None = None


class DuplicateMutationBody(BaseModel):
    """Explicit source → copy roles."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    kind: Literal["duplicate"] = "duplicate"
    source: MutationSubject
    #: Named ``copy_subject`` in Python (``BaseModel.copy`` shadow); the wire
    #: shape is still ``copy`` per §6.1's explicit source/copy contract.
    copy_subject: MutationSubject = Field(alias="copy")


class ReorderMutationBody(BaseModel):
    """Authoritative resulting order and optional authoritative old ranks."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["reorder"] = "reorder"
    new_order: tuple[MutationSubject, ...] = Field(min_length=1, max_length=20)
    old_ranks: tuple[int, ...] | None = None
    moved_index: int | None = Field(default=None, ge=0)
    moved_from_rank: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _old_ranks_shape(self) -> ReorderMutationBody:
        if self.old_ranks is not None and len(self.old_ranks) != len(self.new_order):
            raise ValueError("old_ranks must have one entry per new_order subject")
        return self


EssayEditLocationKind = Literal["paragraph_range", "word_range", "unavailable"]


class EssayEditLocation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: EssayEditLocationKind
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _bounds_present_unless_unavailable(self) -> EssayEditLocation:
        if self.kind != "unavailable" and (self.start is None or self.end is None):
            raise ValueError("a resolvable location requires start and end")
        return self


EssayEditOperationKind = Literal["insert", "delete", "replace"]


class EssayEditOperation(BaseModel):
    """One ordered edit operation — structural facts only, never prose."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    location: EssayEditLocation
    operation: EssayEditOperationKind
    before_words: int = Field(ge=0)
    after_words: int = Field(ge=0)


class EssayEditMutationBody(BaseModel):
    """Ordered edit operations plus final word metrics — no essay prose."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["essay_edit"] = "essay_edit"
    subject: MutationSubject
    operations: tuple[EssayEditOperation, ...] = Field(min_length=1, max_length=20)
    final_word_count: int = Field(ge=0)
    word_limit: int | None = Field(default=None, ge=0)


EssayWriteMode = Literal["drafted", "replaced"]


class EssayWriteMutationBody(BaseModel):
    """Full-draft replacement facts — word metrics only, never an excerpt."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["essay_write"] = "essay_write"
    subject: MutationSubject
    mode: EssayWriteMode
    previous_word_count: int | None = Field(default=None, ge=0)
    final_word_count: int = Field(ge=0)
    word_limit: int | None = Field(default=None, ge=0)


class ProfileSectionChange(BaseModel):
    """One profile section's grouped field changes."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    section_key: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    section_label: str
    changes: tuple[MutationChange, ...] = Field(min_length=1, max_length=20)


class ProfileMutationBody(BaseModel):
    """Section-grouped profile field changes (default-deny exposure, §8.2)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["profile"] = "profile"
    sections: tuple[ProfileSectionChange, ...] = Field(min_length=1, max_length=10)


MemoryOperation = Literal["remember", "update_memory", "forget"]


class MemoryMutationBody(BaseModel):
    """Operation-specific active-note facts; old/forgotten content never rides here."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["memory"] = "memory"
    operation: MemoryOperation
    note_count: int = Field(ge=1)
    #: Exact new active content, capped at the existing 200-char memory limit.
    #: Empty for ``forget`` — forgetting never repeats prior content (§8.1).
    active_notes: tuple[BoundedDisplayText, ...] = Field(default=(), max_length=20)

    @model_validator(mode="after")
    def _forget_carries_no_content(self) -> MemoryMutationBody:
        if self.operation == "forget" and self.active_notes:
            raise ValueError("forget must not carry note content")
        if self.operation != "forget" and not self.active_notes:
            raise ValueError(f"operation={self.operation!r} requires active_notes")
        if self.operation != "forget" and len(self.active_notes) != self.note_count:
            raise ValueError("active_notes length must match note_count")
        return self


UnresolvedVerification = Literal[
    "task_list", "school_list", "essay_list", "activity_list", "honor_list",
    "profile", "memory_list",
]


class UnresolvedMutationBody(BaseModel):
    """No domain identity — only a verification destination (§6.1).

    Valid only for ``outcome in {failed, unknown}`` when authoritative identity
    is unavailable; enforced by :class:`WorkspaceMutationReceipt`, not here.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["unresolved"] = "unresolved"
    family: MutationFamily
    verification: UnresolvedVerification
    attempted_count: int | None = Field(default=None, ge=0)


MutationBody = Annotated[
    BatchMutationBody
    | UpdateMutationBody
    | StateTransitionMutationBody
    | DuplicateMutationBody
    | ReorderMutationBody
    | EssayEditMutationBody
    | EssayWriteMutationBody
    | ProfileMutationBody
    | MemoryMutationBody
    | UnresolvedMutationBody,
    Field(discriminator="kind"),
]

#: The allowed (family, action) -> {allowed body kinds} matrix (§6.1). A
#: family/action pair absent from this map is itself invalid.
_ALLOWED_BODY_KINDS: dict[tuple[MutationFamily, MutationAction], frozenset[MutationBodyKind]] = {
    ("task", "create"): frozenset({"batch"}),
    ("task", "update"): frozenset({"update"}),
    ("task", "archive"): frozenset({"batch"}),
    ("task", "restore"): frozenset({"state_transition"}),
    ("school", "create"): frozenset({"batch"}),
    ("school", "update"): frozenset({"update"}),
    ("school", "archive"): frozenset({"batch"}),
    ("school", "restore"): frozenset({"state_transition"}),
    ("essay", "create"): frozenset({"batch"}),
    ("essay", "update"): frozenset({"update"}),
    ("essay", "duplicate"): frozenset({"duplicate"}),
    ("essay", "archive"): frozenset({"batch"}),
    ("essay", "restore"): frozenset({"state_transition"}),
    ("essay_content", "edit"): frozenset({"essay_edit"}),
    ("essay_content", "write"): frozenset({"essay_write"}),
    ("activity", "create"): frozenset({"batch"}),
    ("activity", "update"): frozenset({"update"}),
    ("activity", "archive"): frozenset({"batch"}),
    ("activity", "restore"): frozenset({"state_transition"}),
    ("activity", "reorder"): frozenset({"reorder"}),
    ("honor", "create"): frozenset({"batch"}),
    ("honor", "update"): frozenset({"update"}),
    ("honor", "archive"): frozenset({"batch"}),
    ("honor", "restore"): frozenset({"state_transition"}),
    ("honor", "reorder"): frozenset({"reorder"}),
    ("profile", "update"): frozenset({"profile"}),
    ("memory", "remember"): frozenset({"memory"}),
    ("memory", "update_memory"): frozenset({"memory"}),
    ("memory", "forget"): frozenset({"memory"}),
}


class WorkspaceMutationReceipt(BaseModel):
    """The one public mutation-receipt envelope (§6.1)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    v: Literal[1] = 1
    family: MutationFamily
    action: MutationAction
    outcome: MutationOutcome
    body: MutationBody
    notices: tuple[MutationNotice, ...] = Field(default=(), max_length=6)
    omissions: MutationOmissions = MutationOmissions()

    @model_validator(mode="after")
    def _family_action_body_allowed(self) -> WorkspaceMutationReceipt:
        if self.body.kind == "unresolved":
            if self.outcome not in ("failed", "unknown"):
                raise ValueError("an unresolved body is only valid for failed/unknown outcomes")
            return self
        if self.outcome == "unknown":
            raise ValueError("outcome='unknown' must use an unresolved body")
        allowed = _ALLOWED_BODY_KINDS.get((self.family, self.action))
        if allowed is None:
            raise ValueError(f"family={self.family!r}, action={self.action!r} is not a valid pair")
        if self.body.kind not in allowed:
            raise ValueError(
                f"family={self.family!r}, action={self.action!r} cannot use body.kind="
                f"{self.body.kind!r}"
            )
        return self
