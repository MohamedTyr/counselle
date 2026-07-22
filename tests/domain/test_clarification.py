"""v2 clarification contracts (plans/clarifying-questions.md "Versioned contracts")."""

from typing import Literal

import pytest
from pydantic import ValidationError

from domain.clarification import (
    ClarifyAnswerV2,
    ClarifyDraftV2,
    ClarifyOptionDraft,
    ClarifyQuestionDraft,
    ClarifyResponseInvalid,
    ClarifySpecV2,
    WidgetClarifyResponseV2,
    normalize_clarify_draft,
    parse_clarify_spec,
    render_clarify_model_payload,
    render_clarify_summary,
    validate_clarify_response,
)
from domain.specs import ClarifySpec


def _option(label: str = "Yes", hint: str | None = "explains why") -> ClarifyOptionDraft:
    return ClarifyOptionDraft(label=label, hint=hint)


def _question(
    n_options: int = 2, selection: Literal["single", "multiple"] = "single"
) -> ClarifyQuestionDraft:
    options = [_option(label=f"Option {i}") for i in range(n_options)]
    return ClarifyQuestionDraft(question="Good for what?", selection=selection, options=options)


def _draft(n_questions: int = 1) -> ClarifyDraftV2:
    return ClarifyDraftV2(questions=[_question() for _ in range(n_questions)])


# --- ClarifyDraftV2: question/option counts -------------------------------


def test_draft_accepts_one_to_three_questions() -> None:
    for n in (1, 2, 3):
        assert len(_draft(n).questions) == n


def test_draft_rejects_zero_and_four_questions() -> None:
    with pytest.raises(ValidationError):
        ClarifyDraftV2(questions=[])
    with pytest.raises(ValidationError):
        ClarifyDraftV2(questions=[_question() for _ in range(4)])


def test_question_accepts_two_to_five_options() -> None:
    for n in (2, 3, 4, 5):
        assert len(_question(n).options) == n


def test_question_rejects_one_and_six_options() -> None:
    with pytest.raises(ValidationError):
        _question(1)
    with pytest.raises(ValidationError):
        _question(6)


# --- Blank/bounded, duplicate, reserved-label rules -----------------------


def test_option_label_rejects_blank() -> None:
    with pytest.raises(ValidationError, match="non-blank"):
        ClarifyOptionDraft(label="   ")


def test_option_label_rejects_over_bound() -> None:
    with pytest.raises(ValidationError, match="exceeds"):
        ClarifyOptionDraft(label="x" * 81)


def test_hint_rejects_over_bound_but_allows_blank() -> None:
    with pytest.raises(ValidationError, match="exceeds"):
        ClarifyOptionDraft(label="Yes", hint="x" * 161)
    assert ClarifyOptionDraft(label="Yes", hint="").hint == ""


def test_question_text_rejects_blank_and_over_bound() -> None:
    with pytest.raises(ValidationError):
        ClarifyQuestionDraft(question=" ", selection="single", options=[_option(), _option("No")])
    with pytest.raises(ValidationError):
        ClarifyQuestionDraft(
            question="x" * 241, selection="single", options=[_option(), _option("No")]
        )


def test_duplicate_option_labels_rejected_case_insensitively() -> None:
    with pytest.raises(ValidationError, match="duplicate"):
        ClarifyQuestionDraft(
            question="Good for what?",
            selection="single",
            options=[_option("Financial aid"), _option("financial aid")],
        )


@pytest.mark.parametrize("reserved", ["Other", "something else", "NONE OF THE ABOVE"])
def test_reserved_option_labels_rejected(reserved: str) -> None:
    with pytest.raises(ValidationError, match="reserved"):
        ClarifyOptionDraft(label=reserved)


# --- v1/v2 dispatch ----------------------------------------------------


def test_dispatch_treats_missing_v_as_legacy_v1() -> None:
    payload = {"question": "Q", "header": "H", "multi_select": False, "options": []}
    payload["options"] = [
        {"label": "A", "hint": "a"},
        {"label": "B", "hint": "b"},
    ]
    spec = parse_clarify_spec(payload)
    assert isinstance(spec, ClarifySpec)
    assert spec.v == 1


def test_dispatch_v2() -> None:
    draft = _draft(1)
    spec_v2 = normalize_clarify_draft(draft)
    spec = parse_clarify_spec(spec_v2.model_dump())
    assert isinstance(spec, ClarifySpecV2)


def test_dispatch_rejects_unknown_version() -> None:
    with pytest.raises(ValueError, match="unknown clarify spec version"):
        parse_clarify_spec({"v": 3})


# --- Normalization: deterministic IDs, trimming, hint blank->None --------


def test_normalize_assigns_positional_ids() -> None:
    draft = ClarifyDraftV2(
        questions=[
            _question(2),
            _question(3),
        ]
    )
    spec = normalize_clarify_draft(draft)
    assert [q.id for q in spec.questions] == ["q1", "q2"]
    assert [o.id for o in spec.questions[0].options] == ["q1_o1", "q1_o2"]
    assert [o.id for o in spec.questions[1].options] == ["q2_o1", "q2_o2", "q2_o3"]


def test_normalize_trims_whitespace_preserving_internal_wording() -> None:
    draft = ClarifyDraftV2(
        questions=[
            ClarifyQuestionDraft(
                question="  Good  for what?  ",
                selection="single",
                options=[
                    ClarifyOptionDraft(label="  Financial  aid  ", hint="  helps a lot  "),
                    ClarifyOptionDraft(label="Merit"),
                ],
            )
        ]
    )
    spec = normalize_clarify_draft(draft)
    assert spec.questions[0].question == "Good  for what?"
    assert spec.questions[0].options[0].label == "Financial  aid"
    assert spec.questions[0].options[0].hint == "helps a lot"


def test_normalize_treats_blank_hint_as_none() -> None:
    draft = ClarifyDraftV2(
        questions=[
            ClarifyQuestionDraft(
                question="Good for what?",
                selection="single",
                options=[
                    ClarifyOptionDraft(label="Financial aid", hint="   "),
                    ClarifyOptionDraft(label="Merit"),
                ],
            )
        ]
    )
    spec = normalize_clarify_draft(draft)
    assert spec.questions[0].options[0].hint is None
    assert spec.questions[0].options[1].hint is None


def test_normalize_is_total_for_any_validated_draft() -> None:
    for n_q in (1, 2, 3):
        for n_o in (2, 3, 4, 5):
            draft = ClarifyDraftV2(questions=[_question(n_o) for _ in range(n_q)])
            normalize_clarify_draft(draft)  # must not raise


# --- Response validation invariants --------------------------------------


def _spec() -> ClarifySpecV2:
    return normalize_clarify_draft(
        ClarifyDraftV2(
            questions=[
                _question(2, selection="single"),
                _question(3, selection="multiple"),
            ]
        )
    )


def test_response_validation_accepts_valid_answers() -> None:
    spec = _spec()
    response = WidgetClarifyResponseV2(
        answers=(
            ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",)),
            ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1", "q2_o2")),
        )
    )
    answers = validate_clarify_response(spec, response)
    assert len(answers) == 2


def test_single_choice_exclusive_preset_or_custom_never_both() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="single_choice_exclusive"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(
                    ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",), custom_text="x"),
                    ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1",)),
                )
            ),
        )


def test_single_choice_requires_exactly_one_answer() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="single_choice_required"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(
                    ClarifyAnswerV2(question_id="q1", option_ids=()),
                    ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1",)),
                )
            ),
        )


def test_multiple_choice_requires_at_least_one_preset_or_custom() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="multiple_choice_required"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(
                    ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",)),
                    ClarifyAnswerV2(question_id="q2", option_ids=()),
                )
            ),
        )


def test_missing_question_rejected() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="question_mismatch"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",)),)
            ),
        )


def test_unknown_question_rejected() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="question_mismatch"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(
                    ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",)),
                    ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1",)),
                    ClarifyAnswerV2(question_id="q99", option_ids=()),
                )
            ),
        )


def test_duplicate_question_rejected() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="duplicate_question"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(
                    ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",)),
                    ClarifyAnswerV2(question_id="q1", option_ids=("q1_o2",)),
                    ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1",)),
                )
            ),
        )


def test_unknown_option_rejected() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="unknown_option"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(
                    ClarifyAnswerV2(question_id="q1", option_ids=("bogus",)),
                    ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1",)),
                )
            ),
        )


def test_duplicate_option_rejected() -> None:
    spec = _spec()
    with pytest.raises(ClarifyResponseInvalid, match="duplicate_option"):
        validate_clarify_response(
            spec,
            WidgetClarifyResponseV2(
                answers=(
                    ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",)),
                    ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1", "q2_o1")),
                )
            ),
        )


def test_custom_text_bounded() -> None:
    with pytest.raises(ValidationError, match="exceeds"):
        ClarifyAnswerV2(question_id="q1", custom_text="x" * 1001)


# --- Presentation summary + model payload projections ---------------------


def test_render_clarify_summary_is_deterministic_and_ordered() -> None:
    spec = _spec()
    answers = (
        ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1",)),
        ClarifyAnswerV2(question_id="q1", option_ids=("q1_o1",), custom_text=""),
    )
    summary = render_clarify_summary(spec, answers)
    lines = summary.split("\n\n")
    assert lines[0].startswith("Q: Good for what?")
    assert "A: Option 0" in lines[0]
    assert len(lines) == 2


def test_render_clarify_model_payload_preserves_custom_text_verbatim() -> None:
    spec = _spec()
    answers = (
        ClarifyAnswerV2(question_id="q1", custom_text="  My own answer  "),
        ClarifyAnswerV2(question_id="q2", option_ids=("q2_o1",)),
    )
    payload = render_clarify_model_payload(spec, answers)
    assert "My own answer" in payload
    assert payload.startswith("Good for what? -> My own answer")
