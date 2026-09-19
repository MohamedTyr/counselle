"""SPR extraction / cross-check tests (plan.md §3.5, §3.6 G10, §8.2).

``tests/domain/sat/upstream/vectors/spr_extraction.json`` records upstream's
``extractSprAnswerFromRationale`` output over every sample SPR rationale
(qbank, ibn/live-bluebook, and legacy disclosed) in the research corpus.
Every case is asserted; a genuine mismatch is reported, never weakened.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from domain.sat.spr_answers import cross_check, extract_spr_candidates

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS_DIR = REPO_ROOT / "tests" / "domain" / "sat" / "upstream" / "vectors"


@pytest.fixture(scope="module")
def spr_vector() -> dict[str, Any]:
    vector = json.loads((VECTORS_DIR / "spr_extraction.json").read_text())
    assert isinstance(vector, dict)
    return vector


def test_spr_extraction_vector_has_expected_shape(spr_vector: dict[str, Any]) -> None:
    assert spr_vector["suite"] == "spr_extraction"
    assert spr_vector["count"] == len(spr_vector["cases"]) == 38


def test_extract_spr_candidates_matches_upstream_for_every_vector_case(
    spr_vector: dict[str, Any],
) -> None:
    failures: list[str] = []
    for case in spr_vector["cases"]:
        got = extract_spr_candidates(case["rationale"])
        if got != case["extracted"]:
            failures.append(f"{case['source']}:\n  got={got!r}\n  exp={case['extracted']!r}")
    if failures:
        pytest.fail(
            f"{len(failures)} spr_extraction mismatches:\n" + "\n".join(failures), pytrace=False
        )


# --- Direct behavioural tests (regex-pipeline edge cases the plan calls
# out: LaTeX \frac, MathML mfrac, <img alt>, written fractions, "Note
# that…", multi-answer lists, the all-"0" filter) -------------------------


def test_extract_spr_candidates_empty_rationale_returns_empty() -> None:
    assert extract_spr_candidates("") == []


def test_extract_spr_candidates_reads_latex_frac() -> None:
    assert extract_spr_candidates(r"The answer is \frac{7}{6}.") == ["7/6"]


def test_extract_spr_candidates_reads_mathml_mfrac() -> None:
    html = "<p>The correct answer is <mfrac><mn>7</mn><mn>6</mn></mfrac>.</p>"
    assert "7/6" in extract_spr_candidates(html)


def test_extract_spr_candidates_reads_img_alt_text() -> None:
    html = '<p>The correct answer is <img alt="7/6"> as shown.</p>'
    assert "7/6" in extract_spr_candidates(html)


def test_extract_spr_candidates_reads_math_alttext() -> None:
    html = (
        '<p>The correct answer is <math alttext="7/6">'
        "<mfrac><mn>7</mn><mn>6</mn></mfrac></math>.</p>"
    )
    assert "7/6" in extract_spr_candidates(html)


def test_extract_spr_candidates_parses_written_fraction() -> None:
    html = "<p>The correct answer is two thirds.</p>"
    assert extract_spr_candidates(html) == ["2/3"]


def test_extract_spr_candidates_reads_note_that_phrasing() -> None:
    html = "<p>Note that 7/6, 1.166, and 1.167 are examples of ways to enter a correct answer.</p>"
    got = extract_spr_candidates(html)
    assert "7/6" in got
    assert "1.166" in got
    assert "1.167" in got


def test_extract_spr_candidates_reads_multi_answer_list() -> None:
    html = "<p>The correct answers are 3 and 4.</p>"
    got = extract_spr_candidates(html)
    assert "3" in got
    assert "4" in got


def test_extract_spr_candidates_drops_all_zero_but_keeps_mixed() -> None:
    """Port of upstream's own all-"0" filter *inside*
    ``extractSprAnswerFromRationale`` (distinct from the "0"-is-a-real-answer
    rule for the official key in ``domain/sat/normalize.py`` — this
    function only ever proposes candidates from prose, never the key
    itself)."""
    assert extract_spr_candidates("<p>The correct answer is 0.</p>") == ["0"]
    html = "<p>The correct answers are 0 and 5.</p>"
    got = extract_spr_candidates(html)
    assert "0" not in got
    assert "5" in got


def test_extract_spr_candidates_ignores_non_numeric_prose() -> None:
    assert extract_spr_candidates("<p>This question has no numeric answer mentioned.</p>") == []


# --- cross_check (G10) ------------------------------------------------------


def test_cross_check_returns_only_what_the_grader_would_not_accept() -> None:
    accepted = {"3"}
    residue = cross_check(
        official_keys=["3"],
        candidates=["3", "4"],
        accepts=lambda candidate: candidate in accepted,
    )
    assert residue == ["4"]


def test_cross_check_skips_values_already_in_official_keys() -> None:
    residue = cross_check(official_keys=["7/6"], candidates=["7/6"], accepts=lambda _c: False)
    assert residue == []


def test_cross_check_returns_nothing_when_everything_is_accepted() -> None:
    residue = cross_check(official_keys=[], candidates=["1/2", "0.5"], accepts=lambda _c: True)
    assert residue == []


def test_cross_check_preserves_order_and_duplicates_of_input() -> None:
    residue = cross_check(official_keys=[], candidates=["9", "9", "8"], accepts=lambda _c: False)
    assert residue == ["9", "9", "8"]
