"""The code-owned gate on supplemental prompts: only verbatim text reaches a student."""

from domain.supplements import SupplementPrompt, block_hash, prompts_hash, verify_prompts

BLOCK = """Smith College Writing

Smith has a unique housing system, where students live together in 41 different houses.

What would you bring to this residential environment? (Please answer in 250 words or less.)

1. Our community lives by the words “Know Thyself” — how would you grow?

Max. 350 words

Please complete this sentence in three to five words."""


def _p(text: str, **kw: object) -> SupplementPrompt:
    return SupplementPrompt(prompt=text, **kw)  # type: ignore[arg-type]


def test_verbatim_prompt_passes_despite_typography_and_list_markers() -> None:
    kept, rejected = verify_prompts(
        [
            _p(
                'Our community lives by the words "Know Thyself" - how would you grow?',
                word_limit=350,
            )
        ],
        BLOCK,
    )
    assert len(kept) == 1 and not rejected


def test_prompt_copied_without_its_inline_limit_still_matches() -> None:
    kept, _ = verify_prompts(
        [_p("What would you bring to this residential environment?", word_limit=250)], BLOCK
    )
    assert len(kept) == 1


def test_paraphrased_prompt_is_rejected() -> None:
    kept, rejected = verify_prompts(
        [_p("What will you bring to the residential environment?")], BLOCK
    )
    assert not kept
    assert rejected[0].reason == "text not found in the source block"


def test_word_limit_not_stated_in_block_is_rejected() -> None:
    kept, rejected = verify_prompts(
        [_p("What would you bring to this residential environment?", word_limit=650)], BLOCK
    )
    assert not kept and "650" in rejected[0].reason


def test_word_limit_written_as_a_number_word_passes() -> None:
    kept, _ = verify_prompts(
        [_p("Please complete this sentence in three to five words.", word_limit=5)], BLOCK
    )
    assert len(kept) == 1


def test_context_must_also_be_verbatim() -> None:
    kept, rejected = verify_prompts(
        [
            _p(
                "What would you bring to this residential environment?",
                context="Smith has a unique housing system with 40 houses.",
            )
        ],
        BLOCK,
    )
    assert not kept and rejected[0].reason == "context not found in the source block"


def test_hashes_ignore_order_and_whitespace_but_not_wording() -> None:
    a, b = _p("Why us?", word_limit=100), _p("Why now?")
    assert prompts_hash([a, b]) == prompts_hash([b, a])
    assert prompts_hash([a]) != prompts_hash([a.model_copy(update={"word_limit": 150})])
    assert block_hash("Why  us?\n") == block_hash("Why us?")
    assert block_hash("Why us?") != block_hash("Why them?")


def test_prompt_key_ignores_typography_but_not_wording() -> None:
    from domain.supplements import prompt_key

    assert prompt_key("Why  us\u2019?") == prompt_key("why us'?")
    assert prompt_key("Why us?") != prompt_key("Why them?")


def test_essay_title_prefers_the_question_and_fits_a_row() -> None:
    from domain.supplements import essay_title

    assert essay_title("Columbia is in New York. Why Columbia?") == "Why Columbia?"
    long = "Describe " + "a very long thing " * 10 + "in detail."
    title = essay_title(long)
    assert len(title) <= 64 and title.endswith("\u2026")


def test_best_rewording_matches_a_light_edit_and_rejects_a_new_prompt() -> None:
    from domain.supplements import best_rewording

    old = "Why are you interested in attending Duke, and what would you contribute?"
    new = [
        "What would you fight for?",
        "Why are you interested in Duke, and what will you contribute?",
    ]
    assert best_rewording(old, new) == 1
    assert best_rewording(old, ["What would you fight for?"]) is None


def test_essay_title_skips_context_and_follow_up_questions() -> None:
    from domain.supplements import essay_title

    prompt = (
        "Virtually all undergraduates live on campus. Write a note to your future "
        "roommate. How will it help us know you?"
    )
    assert essay_title(prompt) == "Write a note to your future roommate."
    assert essay_title("Harvard values debate. Describe a disagreement. How did you engage?") == (
        "Describe a disagreement."
    )
