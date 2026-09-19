"""Grading parity + O7 tests (plan.md §4.3, parity-inventory Q22).

The 632-case vector suite is captured from liprep's own ``checkIsCorrect``
(``tests/domain/sat/upstream/harness/generate.grading.spec.ts``); every case
is asserted individually so a mismatch names its own failing case id. The
O7 cases below are hand-derived from the plan's own rule text and
cross-checked against ``tests/domain/sat/upstream/harness/lib/o7.ts`` — an
independent reference implementation, since upstream itself cannot produce
them (O7 does not exist there).
"""

import json
from fractions import Fraction
from pathlib import Path
from typing import Any, cast

import pytest

from domain.sat.grading import (
    _unambiguous_exact_value,
    accepts_under_o7,
    is_correct,
    parse_numeric,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS_PATH = REPO_ROOT / "tests" / "domain" / "sat" / "upstream" / "vectors" / "grading.json"


def _load_cases() -> list[dict[str, Any]]:
    payload: dict[str, Any] = json.loads(VECTORS_PATH.read_text())
    return cast("list[dict[str, Any]]", payload["cases"])


def _case_id(index: int, case: dict[str, Any]) -> str:
    suite_case = Path(str(case["suiteCase"])).name
    return f"{index}:{suite_case}:{case['variant']}:{case['answer']!r}"


_CASES = _load_cases()


@pytest.mark.parametrize("case", _CASES, ids=[_case_id(i, c) for i, c in enumerate(_CASES)])
def test_grading_vector(case: dict[str, Any]) -> None:
    # The "o7_*" variants are captured from o7.ts's acceptsUnderO7() in
    # isolation (generate.grading.spec.ts), not from checkIsCorrect/
    # is_correct — several of them (e.g. a terminating fraction's own
    # padded decimal) would already be granted by step (c) before O7 is
    # ever reached, so they are only meaningful checked against the O7
    # path directly.
    if case["variant"].startswith("o7"):
        result = accepts_under_o7(case["correct_answer"], case["answer"])
        fn = "accepts_under_o7"
    else:
        result = is_correct(case["question_type"], case["correct_answer"], case["answer"])
        fn = "is_correct"
    assert result == case["expected"], (
        f"{fn}({case['correct_answer']!r}, {case['answer']!r}) = {result}, "
        f"expected {case['expected']} (variant={case['variant']!r}, "
        f"suiteCase={case['suiteCase']!r})"
    )


def test_grading_vector_suite_is_nonempty() -> None:
    # A guard against a silently-empty vector file passing this module
    # vacuously (632 cases at the time this suite was captured).
    assert len(_CASES) >= 600


# --- O7 (d): hand-derived, per plan §4.3 and o7.ts ------------------------

# accepts_under_o7 in isolation: the rule's own field-width/digit-beyond/
# truncate-or-round logic, independent of whether (a)-(c) would already
# have granted the same answer.
_O7_ONLY_CASES = [
    # College Board's own published 2/3 table (plan §4.3).
    (["2/3"], ".6666", True),
    (["2/3"], ".6667", True),
    (["2/3"], "0.666", True),
    (["2/3"], "0.667", True),
    (["2/3"], "0.66", False),
    (["2/3"], ".66", False),
    (["2/3"], "0.67", False),
    (["2/3"], ".67", False),
    # 16/17: liprep's key list only has .9411/.9412 — O7 additionally
    # accepts the field-filling truncation/rounding upstream rejects.
    (["16/17"], "0.941", True),
    (["16/17"], ".9411", True),
    # Negatives: truncation toward zero, not floor — and, symmetrically
    # with the 2/3 table above, the rounded form is also accepted.
    (["-2/3"], "-0.666", True),
    (["-2/3"], "-.6666", True),
    (["-2/3"], "-.6667", True),
    (["-2/3"], "-0.667", True),
    (["-2/3"], "-0.668", False),
    # No unambiguous V: two differently-rounded decimals, no fraction key
    # at all — (d) must not apply, even though one of them alone would
    # otherwise be a valid field-filling entry.
    (["0.666", "0.667"], ".6666", False),
    # A terminating fraction: no digit beyond the field, (d) never
    # applies regardless of field width.
    (["1/4"], ".250", False),
    (["1/4"], ".2500", False),
    # One digit short of the field (4 chars, not 5) — rejected on length
    # alone, independent of correctness.
    (["2/7"], ".285", False),
    # One digit wrong at the correct field width.
    (["2/7"], ".2858", False),
    # Longer than College Board's field (7 chars, liprep's own max) — (d)
    # never applies; such an entry is judged by (a)-(c) alone.
    (["15.5", "31/2"], "15.500000000", False),
    # Rounding carries out of the fractional part into the integer part
    # (0.9999 rounds up to 1 at 3 places): the truncated form ("0.999",
    # the field-filling entry — ".999" alone is one character short) and
    # the rounded form ("1.000") are both accepted; the rounded digits
    # alone, without the carried integer part, are not.
    (["9999/10000"], "0.999", True),
    (["9999/10000"], "1.000", True),
    (["9999/10000"], "0.000", False),
    # The same carry, negated: truncation stays "-0.999", rounding
    # carries to "-1.000" — never the sign-only "-0.000".
    (["-9999/10000"], "-0.999", True),
    (["-9999/10000"], "-1.000", True),
    (["-9999/10000"], "-0.000", False),
    # A carry that also increments an already-nonzero integer part
    # (1.9999 rounds up to 2 at 3 places).
    (["19999/10000"], "1.999", True),
    (["19999/10000"], "2.000", True),
    (["19999/10000"], "1.000", False),
]


@pytest.mark.parametrize(("correct_answer", "answer", "expected"), _O7_ONLY_CASES)
def test_o7_field_filling_rule(correct_answer: list[str], answer: str, expected: bool) -> None:
    assert accepts_under_o7(correct_answer, answer) is expected


@pytest.mark.parametrize(
    ("correct_answer", "answer", "expected"),
    [
        # (a) already accepts this one; O7 is never reached (and could
        # not apply anyway — no unambiguous V for this key set).
        (["0.666", "0.667"], "0.666", True),
        # An entry longer than College Board's field: (c)'s numeric
        # equivalence accepts it, not O7.
        (["15.5", "31/2"], "15.500000000", True),
        # A case (a)-(c) cannot grant (0.941 is 1.76e-4 off 16/17, over
        # the 1e-6 threshold) that only O7 rescues, through the full
        # grading pipeline.
        (["16/17"], "0.941", True),
    ],
)
def test_o7_only_adds_acceptances_is_correct_pipeline(
    correct_answer: list[str], answer: str, expected: bool
) -> None:
    assert is_correct("spr", correct_answer, answer) is expected


# --- parse_numeric -----------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("3/4", True),
        ("0.75", True),
        (".75", True),
        ("-13/2", True),
        ("not-a-number", False),
        ("1/0", False),
        ("", False),
    ],
)
def test_parse_numeric_validity(text: str, expected: bool) -> None:
    assert (parse_numeric(text) is not None) is expected


# --- _unambiguous_exact_value --------------------------------------------


def test_unambiguous_exact_value_agreeing_fractions_written_differently() -> None:
    assert _unambiguous_exact_value(["2/4", "1/2"]) == Fraction(1, 2)


def test_unambiguous_exact_value_fraction_key_wins_over_decimal_keys() -> None:
    # A fraction key present alongside decimal keys names V on its own —
    # the decimal keys (liprep's own padded near-misses) are ignored.
    assert _unambiguous_exact_value(["16/17", ".9411", ".9412"]) == Fraction(16, 17)


def test_unambiguous_exact_value_disagreeing_fractions_has_no_v() -> None:
    assert _unambiguous_exact_value(["1/2", "1/3"]) is None


def test_unambiguous_exact_value_agreeing_decimals_only() -> None:
    assert _unambiguous_exact_value([".5", "0.50"]) == Fraction(1, 2)


def test_unambiguous_exact_value_disagreeing_decimals_only_has_no_v() -> None:
    assert _unambiguous_exact_value(["0.666", "0.667"]) is None
