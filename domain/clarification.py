"""v2 clarification contracts (plans/clarifying-questions.md "Versioned contracts").

Three layers, kept deliberately separate:

- ``ClarifyDraftV2`` (+ nested ``ClarifyQuestionDraft``/``ClarifyOptionDraft``)
  is the PydanticAI output-tool model. Every model-correctable rule — bounded
  non-blank text, question/option counts, duplicate/reserved labels — lives on
  these models so PydanticAI can retry the output tool on a validation error.
- ``ClarifySpecV2`` (+ nested ``ClarifyQuestionV2``/``ClarifyOptionV2``) is the
  public, code-normalized spec: positional IDs, trimmed text, blank hints
  dropped. ``normalize_clarify_draft`` is total — it must not raise, because
  every input it sees already passed the draft's validators.
- ``PendingClarificationV2``/``ClarifyResponseV2`` are the stored record and
  the student's answer, validated against the stored spec (never against
  client-submitted labels).

v1 ``ClarifySpec``/``ClarifyOption`` (domain/specs.py) are unchanged for read
compatibility with historical records. ``parse_clarify_spec`` is the one
version-aware entry point that decides between them.
"""

from collections.abc import Mapping, Sequence
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from domain.specs import ClarifySpec

# Contract constants (plan "Versioned contracts" — confirmed against prompt/API
# limits, not environment settings).
CLARIFY_QUESTION_MAX_CHARS = 240
CLARIFY_LABEL_MAX_CHARS = 80
CLARIFY_HINT_MAX_CHARS = 160
CLARIFY_CUSTOM_ANSWER_MAX_CHARS = 1000
CLARIFY_REPLY_MAX_CHARS = 4000
#: Overall structured draft payload cap. Worst case is 3 questions x
#: (240-char question + 5 options x (80-char label + 160-char hint)) =
#: 3 * (240 + 5*240) = 4320 raw characters; this leaves headroom for JSON
#: structural overhead without allowing a pathological oversized payload.
CLARIFY_DRAFT_MAX_SERIALIZED_CHARS = 8000
#: Mirrors the draft cap for the answered-response side (bounded option ID
#: references plus up to one bounded custom answer per question).
CLARIFY_RESPONSE_MAX_SERIALIZED_CHARS = 8000

_RESERVED_OPTION_LABELS = {"other", "something else", "none of the above"}


def _bounded_nonblank(value: str, *, max_chars: int, field: str) -> str:
    if not value.strip():
        raise ValueError(f"{field} must be non-blank")
    if len(value.strip()) > max_chars:
        raise ValueError(f"{field} exceeds {max_chars} characters")
    return value


def _bounded_optional(value: str | None, *, max_chars: int, field: str) -> str | None:
    if value is None:
        return value
    if len(value.strip()) > max_chars:
        raise ValueError(f"{field} exceeds {max_chars} characters")
    return value


# --- Draft (model output-tool) models -------------------------------------


class ClarifyOptionDraft(BaseModel):
    """One model-authored option. Product-owned "Something else" is never one
    of these — the reserved-label blocklist below enforces that."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str
    hint: str | None = None

    @field_validator("label")
    @classmethod
    def label_bounded_nonblank(cls, value: str) -> str:
        value = _bounded_nonblank(value, max_chars=CLARIFY_LABEL_MAX_CHARS, field="option label")
        if value.strip().casefold() in _RESERVED_OPTION_LABELS:
            raise ValueError(f"option label {value.strip()!r} is reserved for the product surface")
        return value

    @field_validator("hint")
    @classmethod
    def hint_bounded(cls, value: str | None) -> str | None:
        return _bounded_optional(value, max_chars=CLARIFY_HINT_MAX_CHARS, field="option hint")


class ClarifyQuestionDraft(BaseModel):
    """One model-authored question with 2-5 options."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question: str
    selection: Literal["single", "multiple"]
    options: list[ClarifyOptionDraft] = Field(min_length=2, max_length=5)

    @field_validator("question")
    @classmethod
    def question_bounded_nonblank(cls, value: str) -> str:
        return _bounded_nonblank(value, max_chars=CLARIFY_QUESTION_MAX_CHARS, field="question")

    @model_validator(mode="after")
    def options_unique_case_insensitive(self) -> "ClarifyQuestionDraft":
        seen: set[str] = set()
        for option in self.options:
            key = option.label.strip().casefold()
            if key in seen:
                raise ValueError(f"duplicate option label {option.label.strip()!r}")
            seen.add(key)
        return self


class ClarifyDraftV2(BaseModel):
    """The ``ask_student`` output-tool payload: one to three questions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    questions: list[ClarifyQuestionDraft] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def bounded_serialized_size(self) -> "ClarifyDraftV2":
        if len(self.model_dump_json()) > CLARIFY_DRAFT_MAX_SERIALIZED_CHARS:
            raise ValueError("clarification draft exceeds the overall payload cap")
        return self


# --- Public spec (code-normalized) models ---------------------------------


class ClarifyOptionV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    label: str
    hint: str | None = None


class ClarifyQuestionV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    question: str
    selection: Literal["single", "multiple"]
    options: tuple[ClarifyOptionV2, ...]


class ClarifySpecV2(BaseModel):
    """The normalized, code-owned public spec — the v2 wire/record shape."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    v: Literal[2] = 2
    questions: tuple[ClarifyQuestionV2, ...]


# --- Response models -------------------------------------------------------


class ClarifyAnswerV2(BaseModel):
    """One answer for one stored question: selected option IDs and/or custom
    text, resolved against the stored spec — never client-submitted labels."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    option_ids: tuple[str, ...] = ()
    custom_text: str | None = None

    @field_validator("custom_text")
    @classmethod
    def custom_text_bounded(cls, value: str | None) -> str | None:
        return _bounded_optional(
            value, max_chars=CLARIFY_CUSTOM_ANSWER_MAX_CHARS, field="custom answer text"
        )


class WidgetClarifyResponseV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    v: Literal[2] = 2
    mode: Literal["widget"] = "widget"
    answers: tuple[ClarifyAnswerV2, ...]


class ReplyClarifyResponseV2(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    v: Literal[2] = 2
    mode: Literal["reply"] = "reply"
    text: str
    user_message_id: str

    @field_validator("text")
    @classmethod
    def text_bounded_nonblank(cls, value: str) -> str:
        return _bounded_nonblank(value, max_chars=CLARIFY_REPLY_MAX_CHARS, field="reply text")


ClarifyResponseV2 = Annotated[
    WidgetClarifyResponseV2 | ReplyClarifyResponseV2,
    Field(discriminator="mode"),
]


class PendingClarificationV2(BaseModel):
    """A1's versioned clarification record — the sole source of truth for the
    spec and (once answered) the response. No second copy is ever persisted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    spec: ClarifySpecV2
    response: ClarifyResponseV2 | None = None


# --- Version-aware dispatch -------------------------------------------------


def parse_clarify_spec(payload: Mapping[str, Any]) -> ClarifySpec | ClarifySpecV2:
    """Dispatch a stored/wire clarify spec to its exact model.

    A missing ``v`` is legacy v1. Literal 1/2 dispatch to the matching model.
    Anything else is rejected — never coerced or silently accepted by a loose
    discriminated union on ``v: int``.
    """
    version = payload.get("v")
    if version is None or version == 1:
        return ClarifySpec.model_validate(payload)
    if version == 2:
        return ClarifySpecV2.model_validate(payload)
    raise ValueError(f"unknown clarify spec version: {version!r}")


# --- Normalization (draft -> public spec) -----------------------------------


def normalize_clarify_draft(draft: ClarifyDraftV2) -> ClarifySpecV2:
    """Total: assigns positional IDs, trims whitespace, drops blank hints.

    Must never raise — every value here already passed ``ClarifyDraftV2``'s
    validators, so this function only reshapes already-valid data.
    """
    questions: list[ClarifyQuestionV2] = []
    for q_index, question in enumerate(draft.questions, start=1):
        options: list[ClarifyOptionV2] = []
        for o_index, option in enumerate(question.options, start=1):
            hint = option.hint.strip() if option.hint is not None else None
            options.append(
                ClarifyOptionV2(
                    id=f"q{q_index}_o{o_index}",
                    label=option.label.strip(),
                    hint=hint or None,
                )
            )
        questions.append(
            ClarifyQuestionV2(
                id=f"q{q_index}",
                question=question.question.strip(),
                selection=question.selection,
                options=tuple(options),
            )
        )
    return ClarifySpecV2(questions=tuple(questions))


# --- Response validation against the stored spec ----------------------------


class ClarifyResponseInvalid(Exception):
    """A typed, terse validation failure — never carries raw student text."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def validate_clarify_response(
    spec: ClarifySpecV2, response: WidgetClarifyResponseV2
) -> tuple[ClarifyAnswerV2, ...]:
    """Cross-validate a widget response against A1's stored spec.

    Returns the response's answers unchanged (already trimmed/bounded at the
    field level) on success; raises :class:`ClarifyResponseInvalid` with a
    stable, terse code on any invariant violation.
    """
    if len(response.model_dump_json()) > CLARIFY_RESPONSE_MAX_SERIALIZED_CHARS:
        raise ClarifyResponseInvalid("payload_too_large")

    questions_by_id = {question.id: question for question in spec.questions}
    answers_by_question: dict[str, ClarifyAnswerV2] = {}
    for answer in response.answers:
        if answer.question_id in answers_by_question:
            raise ClarifyResponseInvalid("duplicate_question")
        answers_by_question[answer.question_id] = answer

    if set(answers_by_question) != set(questions_by_id):
        raise ClarifyResponseInvalid("question_mismatch")

    for question_id, answer in answers_by_question.items():
        question = questions_by_id[question_id]
        option_ids = {option.id for option in question.options}
        if any(oid not in option_ids for oid in answer.option_ids):
            raise ClarifyResponseInvalid("unknown_option")
        if len(set(answer.option_ids)) != len(answer.option_ids):
            raise ClarifyResponseInvalid("duplicate_option")

        has_custom = bool(answer.custom_text and answer.custom_text.strip())
        preset_count = len(answer.option_ids)

        if question.selection == "single":
            if has_custom and preset_count > 0:
                raise ClarifyResponseInvalid("single_choice_exclusive")
            if not has_custom and preset_count != 1:
                raise ClarifyResponseInvalid("single_choice_required")
        else:
            if not has_custom and preset_count == 0:
                raise ClarifyResponseInvalid("multiple_choice_required")

    return response.answers


# --- Pure presentation/model-payload projections ----------------------------


def _answer_labels(question: ClarifyQuestionV2, answer: ClarifyAnswerV2) -> list[str]:
    option_by_id = {option.id: option for option in question.options}
    labels = [option_by_id[oid].label for oid in answer.option_ids if oid in option_by_id]
    if answer.custom_text and answer.custom_text.strip():
        labels.append(answer.custom_text.strip())
    return labels


def render_clarify_summary(spec: ClarifySpecV2, answers: Sequence[ClarifyAnswerV2]) -> str:
    """Deterministic plain-text Q&A summary for the whole-run transcript
    serializer. Preset labels are resolved from the stored spec only."""
    answers_by_question = {answer.question_id: answer for answer in answers}
    blocks: list[str] = []
    for question in spec.questions:
        answer = answers_by_question.get(question.id)
        if answer is None:
            continue
        blocks.append(f"Q: {question.question}\nA: {'; '.join(_answer_labels(question, answer))}")
    return "\n\n".join(blocks)


def render_clarify_model_payload(spec: ClarifySpecV2, answers: Sequence[ClarifyAnswerV2]) -> str:
    """Compact deterministic prompt text for A2's server-rendered continuation
    request. Validated custom text is preserved verbatim; preset labels are
    resolved from the stored spec only, never from client-submitted text."""
    answers_by_question = {answer.question_id: answer for answer in answers}
    lines: list[str] = []
    for question in spec.questions:
        answer = answers_by_question.get(question.id)
        if answer is None:
            continue
        lines.append(f"{question.question} -> {', '.join(_answer_labels(question, answer))}")
    return "\n".join(lines)
