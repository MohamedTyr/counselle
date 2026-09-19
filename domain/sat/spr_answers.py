"""Free-response ("SPR") key extraction from rationale HTML (plan §3.5, §3.6
G10).

Ports liprep's ``extractSprAnswerFromRationale`` and ``parseWrittenFraction``
(``tests/domain/sat/upstream/harness/.upstream/src/db.ts``) — a regex
pipeline over the raw rationale HTML string, not a DOM walk. It is ported as
a literal, statement-for-statement translation of that pipeline (not
rebuilt over ``html.parser``) because the differential vectors
(``tests/domain/sat/upstream/vectors/spr_extraction.json``) assert byte-for-
byte parity with upstream's actual regex behaviour; a generic HTML
text-node/attribute walker would not reproduce the same edge-case ordering
(``\\frac``/``mfrac`` before tag-stripping, ``<img alt>`` and MathML
``alttext`` folded into the same plain-text pass, "Note that …" / "the
correct answer(s) is/are …" phrase matching on the *stripped* text) that the
vectors were generated from.

Two populations use this (§3.5): qbank SPR items, where the official
``correct_answer`` is the key and this module runs only as a **cross-check**
(``cross_check``, G10) over what the grader would already accept; and legacy
disclosed SPR items, which carry no key field at all — the extractor's
*proposals* here are never trusted directly (never a build's source of
truth) and go into ``config/assets/sat/spr_keys.yaml`` only after a human
confirms them.

Pure stdlib (ADR 0017): no I/O.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

_NUMERIC_PATTERN = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:/[+-]?(?:\d+\.?\d*|\.\d+))?$")

_FRAC_PATTERN = re.compile(r"\\frac\{([+-]?\d+)\}\{([1-9]\d*)\}", re.IGNORECASE)
_MFRAC_PATTERN = re.compile(
    r"<mfrac>\s*<mn>([+-]?\d+)</mn>\s*<mn>([1-9]\d*)</mn>\s*</mfrac>", re.IGNORECASE
)
_IMG_ALT_PATTERN = re.compile(r"<img\b[^>]*\balt=[\"']([^\"']*)[\"'][^>]*>", re.IGNORECASE)
_MATH_ALTTEXT_PATTERN = re.compile(
    r"<math\b[^>]*\balttext=[\"']([^\"']*)[\"'][^>]*>[\s\S]*?</math>", re.IGNORECASE
)
_NEGATIVE_PATTERN = re.compile(r"\bnegative\s+(\d+)", re.IGNORECASE)
_OVER_PATTERN = re.compile(r"(?:the fraction\s+)?([+-]?\d+)\s+over\s+([+-]?\d+)", re.IGNORECASE)
_NUMERATOR_DENOMINATOR_PATTERN = re.compile(
    r"the fraction with numerator\s+([+-]?\d+)[,\s]+(?:and\s+)?denominator\s+([+-]?\d+)",
    re.IGNORECASE,
)

_TAG_PATTERN = re.compile(r"<[^>]+>")
_NBSP_PATTERN = re.compile(r"&nbsp;", re.IGNORECASE)
_MINUS_PATTERN = re.compile(r"&#8722;|&minus;", re.IGNORECASE)
_QUOTE_PATTERN = re.compile(r"&rsquo;|&lsquo;", re.IGNORECASE)
_DQUOTE_PATTERN = re.compile(r"&quot;", re.IGNORECASE)
_WHITESPACE_PATTERN = re.compile(r"\s+")

_NOTE_PATTERN = re.compile(
    r"Note that\s+(?:either\s+)?([\s\S]+?)\s+"
    r"(?:are examples of ways|is an example of a way|are all examples of ways|"
    r"are acceptable ways|is an acceptable way|to enter a correct answer)",
    re.IGNORECASE,
)
_NOTE_SPLIT_PATTERN = re.compile(r"(?:,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+)", re.IGNORECASE)
_QUOTE_STRIP_PATTERN = re.compile(r"^[\"'`]|[\"'`]$")
_TRAILING_PERIOD_PATTERN = re.compile(r"\.$")

_STANDARD_PATTERN = re.compile(
    r"(?:the\s+)?correct answer(?:s)?\s*(?:is|are)\s*(?:either\s*)?"
    r"([+-]?(?:\d+\.?\d*|\.\d+)(?:/[+-]?(?:\d+\.?\d*|\.\d+))?)",
    re.IGNORECASE,
)
_MULTI_PATTERN = re.compile(
    r"(?:the\s+)?correct answer(?:s)?\s*(?:is|are)\s*(?:either\s*)?"
    r"((?:[+-]?(?:\d+\.?\d*|\.\d+)(?:/[+-]?(?:\d+\.?\d*|\.\d+))?\s*(?:,|or|and)\s*)+"
    r"[+-]?(?:\d+\.?\d*|\.\d+)(?:/[+-]?(?:\d+\.?\d*|\.\d+))?)",
    re.IGNORECASE,
)
_MULTI_SPLIT_PATTERN = re.compile(r"(?:,\s*|\s+or\s+|\s+and\s+)", re.IGNORECASE)
_WORDS_PATTERN = re.compile(
    r"(?:the\s+)?correct answer\s*(?:is|are)\s*(?:either\s*)?([a-z]+(?:-[a-z]+|\s+[a-z]+))",
    re.IGNORECASE,
)
_GENERIC_PATTERN = re.compile(
    r"correct answer[^\d+-]*([+-]?(?:\d+\.?\d*|\.\d+)(?:/[+-]?(?:\d+\.?\d*|\.\d+))?)",
    re.IGNORECASE,
)

_WORDS_TO_NUMBERS: dict[str, int] = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}

_FRACTION_DENOMINATORS: dict[str, int] = {
    "half": 2,
    "halves": 2,
    "third": 3,
    "thirds": 3,
    "fourth": 4,
    "fourths": 4,
    "quarter": 4,
    "quarters": 4,
    "fifth": 5,
    "fifths": 5,
    "sixth": 6,
    "sixths": 6,
    "seventh": 7,
    "sevenths": 7,
    "eighth": 8,
    "eighths": 8,
    "ninth": 9,
    "ninths": 9,
    "tenth": 10,
    "tenths": 10,
    "twelfth": 12,
    "twelfths": 12,
    "sixteenth": 16,
    "sixteenths": 16,
}


def _parse_written_fraction(text: str) -> str | None:
    """Port of upstream's ``parseWrittenFraction`` (``db.ts``): "two thirds"
    -> "2/3". Returns ``None`` when ``text`` isn't exactly one number word
    followed by one fraction-denominator word."""
    cleaned = text.strip().lower().replace("-", " ")
    tokens = cleaned.split()
    if len(tokens) == 2 and tokens[0] in _WORDS_TO_NUMBERS and tokens[1] in _FRACTION_DENOMINATORS:
        return f"{_WORDS_TO_NUMBERS[tokens[0]]}/{_FRACTION_DENOMINATORS[tokens[1]]}"
    return None


def _is_numeric_answer(value: str) -> bool:
    return bool(_NUMERIC_PATTERN.match(value))


def extract_spr_candidates(rationale_html: str) -> list[str]:
    """Port of upstream's ``extractSprAnswerFromRationale`` (``db.ts``).

    Reads both rationale text nodes and ``<img alt="…">`` / MathML
    ``alttext="…"`` content — the legacy disclosed corpus renders math as
    inline images with spoken-math ``alt`` text (§3.1, §3.5), so a
    fractional or radical answer can exist only inside an ``alt``.

    A **proposal**, never a source of truth (§3.5): for qbank items it feeds
    ``cross_check``; for legacy disclosed items every proposal is confirmed
    by a person before it becomes a key in ``spr_keys.yaml``.
    """
    if not rationale_html:
        return []

    frac_answers = [f"{m.group(1)}/{m.group(2)}" for m in _FRAC_PATTERN.finditer(rationale_html)]

    processed = rationale_html
    processed = _MFRAC_PATTERN.sub(r" \1/\2 ", processed)
    processed = _IMG_ALT_PATTERN.sub(r" \1 ", processed)
    processed = _MATH_ALTTEXT_PATTERN.sub(r" \1 ", processed)
    processed = _NEGATIVE_PATTERN.sub(r"-\1", processed)
    processed = _OVER_PATTERN.sub(r" \1/\2 ", processed)
    processed = _NUMERATOR_DENOMINATOR_PATTERN.sub(r" \1/\2 ", processed)

    plain_text = _TAG_PATTERN.sub(" ", processed)
    plain_text = _NBSP_PATTERN.sub(" ", plain_text)
    plain_text = _MINUS_PATTERN.sub("-", plain_text)
    plain_text = _QUOTE_PATTERN.sub("'", plain_text)
    plain_text = _DQUOTE_PATTERN.sub('"', plain_text)
    plain_text = _WHITESPACE_PATTERN.sub(" ", plain_text).strip()

    note_answers: list[str] = []
    note_match = _NOTE_PATTERN.search(plain_text)
    if note_match:
        raw_tokens = _NOTE_SPLIT_PATTERN.split(note_match.group(1))
        for token in raw_tokens:
            candidate = token.strip()
            candidate = _QUOTE_STRIP_PATTERN.sub("", candidate)
            candidate = _TRAILING_PERIOD_PATTERN.sub("", candidate)
            if _is_numeric_answer(candidate):
                note_answers.append(candidate)

    primary_answer = ""
    standard_match = _STANDARD_PATTERN.search(plain_text)
    if standard_match:
        ans = standard_match.group(1).strip()
        if ans.endswith("."):
            ans = ans[:-1]
        if ans:
            primary_answer = ans

    multi_answers: list[str] = []
    multi_match = _MULTI_PATTERN.search(plain_text)
    if multi_match:
        raw_answers = _MULTI_SPLIT_PATTERN.split(multi_match.group(1))
        for token in raw_answers:
            candidate = token.strip()
            candidate = _TRAILING_PERIOD_PATTERN.sub("", candidate)
            if _is_numeric_answer(candidate):
                multi_answers.append(candidate)

    word_answer = ""
    words_match = _WORDS_PATTERN.search(plain_text)
    if words_match:
        parsed = _parse_written_fraction(words_match.group(1))
        if parsed:
            word_answer = parsed

    generic_answer = ""
    generic_match = _GENERIC_PATTERN.search(plain_text)
    if generic_match:
        ans = generic_match.group(1).strip()
        ans = _TRAILING_PERIOD_PATTERN.sub("", ans)
        if ans:
            generic_answer = ans

    combined = [
        primary_answer,
        *frac_answers,
        *multi_answers,
        word_answer,
        *note_answers,
        generic_answer,
    ]
    combined = [a for a in combined if a and _is_numeric_answer(a)]

    unique = list(dict.fromkeys(combined))
    non_zero = [a for a in unique if a != "0"]
    return non_zero if non_zero else unique


def cross_check(
    official_keys: Sequence[str],
    candidates: Sequence[str],
    accepts: Callable[[str], bool],
) -> list[str]:
    """G10: the candidates the grader would **not** already accept against
    the official key. Because grading is numeric (§3.5), almost everything
    ``extract_spr_candidates`` finds for a qbank item is already accepted;
    the residue is a genuine second answer missing from the official key,
    and it — never the extractor's output directly — is what a person
    adjudicates into ``spr_keys.yaml``.

    ``accepts`` is the grader's own accept-or-not decision for one
    candidate against ``official_keys`` (``domain/sat/grading.py``, owned
    elsewhere) — this function does not re-implement numeric acceptance.
    """
    residue: list[str] = []
    for candidate in candidates:
        if candidate in official_keys:
            continue
        if accepts(candidate):
            continue
        residue.append(candidate)
    return residue
