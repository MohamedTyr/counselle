"""SAT attempt grading (plan.md §4.3, parity-inventory Q22; server-side now,
was client-side in liprep).

Ported byte for byte from liprep's own grader, plus one acceptance path it
lacks:

- ``is_correct`` ports ``checkIsCorrect`` — steps (a) case-insensitive string
  match, (b) leading-zero equivalence, (c) spr numeric equivalence.
  ``tests/domain/sat/upstream/harness/.upstream/src/pages/Practice.tsx``
- ``parse_numeric`` ports ``parseNumericValue`` from the same file, but
  returns an exact ``fractions.Fraction`` instead of a ``float`` so grading
  and step (d) below share one exact parse — floats are never used for SPR
  comparison (plan §4.3 requires ``Fraction``/``Decimal``, never floats).
- Step (d) is O7: College Board's own free-response entry rule, which
  liprep does not implement (see the module docstring of
  ``tests/domain/sat/upstream/harness/lib/o7.ts``, the hand-derived
  reference this port is cross-checked against). It is a fourth ``or``: it
  can only add acceptances, never remove one (a)-(c) already grant.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import Literal

ItemType = Literal["mcq", "spr"]

# Q22(c): |user - key| < 1e-6, computed exactly (never as a float).
_NEAR_MISS_EPSILON = Fraction(1, 1_000_000)

# parseNumericValue's regex, verbatim (an optional "/-?..." denominator).
_NUMERIC_RE = re.compile(r"^-?(?:\d+(?:\.\d*)?|\.\d+)(?:/-?(?:\d+(?:\.\d*)?|\.\d+))?$")

# O7 (d): the College Board field entry, and its two field widths (sign +
# decimal point both count toward the field, per plan §4.3).
_O7_ENTRY_RE = re.compile(r"^-?(\d+\.\d+|\.\d+)$")
_O7_POSITIVE_FIELD_LEN = 5
_O7_NEGATIVE_FIELD_LEN = 6
_O7_LEADING_ZERO_RE = re.compile(r"^(-?)0\.")


def parse_numeric(text: str) -> Fraction | None:
    """Port of ``parseNumericValue``: a plain decimal, or ``a/b`` (each side
    itself a signed decimal). ``None`` on anything else — used by grading's
    step (c) and by the O7 audit gate (G4) alike.
    """
    trimmed = text.strip()
    if not _NUMERIC_RE.match(trimmed):
        return None
    if "/" in trimmed:
        num_text, den_text = trimmed.split("/", 1)
        num = _parse_decimal_literal(num_text)
        den = _parse_decimal_literal(den_text)
        if num is None or den is None or den == 0:
            return None
        return num / den
    return _parse_decimal_literal(trimmed)


def _parse_decimal_literal(text: str) -> Fraction | None:
    try:
        return Fraction(Decimal(text))
    except (InvalidOperation, ValueError):
        return None


def _strip_leading_zero(cleaned: str) -> str | None:
    if cleaned.startswith("0."):
        return cleaned[1:]
    if cleaned.startswith("-0."):
        return "-" + cleaned[2:]
    return None


def _add_leading_zero(cleaned: str) -> str | None:
    if cleaned.startswith("."):
        return "0" + cleaned
    if cleaned.startswith("-."):
        return "-0" + cleaned[1:]
    return None


def is_correct(item_type: ItemType, keys: Iterable[str], answer: str) -> bool:
    """liprep's ``checkIsCorrect``, plus O7 (d) as a fourth acceptance path
    (plan §4.3). ``keys`` is the question's ``correct_answers``.
    """
    keys = tuple(keys)
    cleaned = answer.strip().lower()
    normalized_keys = {key.strip().lower() for key in keys}

    if cleaned in normalized_keys:
        return True

    no_lead_zero = _strip_leading_zero(cleaned)
    if no_lead_zero is not None and no_lead_zero in normalized_keys:
        return True

    with_lead_zero = _add_leading_zero(cleaned)
    if with_lead_zero is not None and with_lead_zero in normalized_keys:
        return True

    if item_type != "spr":
        return False

    parsed_user = parse_numeric(answer)
    if parsed_user is not None:
        for key in keys:
            parsed_key = parse_numeric(key)
            if parsed_key is not None and abs(parsed_user - parsed_key) < _NEAR_MISS_EPSILON:
                return True

    return accepts_under_o7(keys, answer)


# --- O7: College Board's free-response entry rule (plan §4.3(d)) ----------


def _unambiguous_exact_value(keys: Iterable[str]) -> Fraction | None:
    """The exact value V a key set unambiguously names: all ``a/b`` keys
    numerically equal, if any exist; else a single decimal value every
    decimal key agrees on. Anything else (no fraction key, and decimal keys
    that disagree) has no V, and (d) does not apply.
    """
    parsed = [(key, parse_numeric(key)) for key in keys]
    fraction_values = [v for k, v in parsed if "/" in k.strip() and v is not None]
    if fraction_values:
        first = fraction_values[0]
        return first if all(v == first for v in fraction_values) else None

    decimal_values = [v for k, v in parsed if "/" not in k.strip() and v is not None]
    if not decimal_values:
        return None
    first = decimal_values[0]
    return first if all(v == first for v in decimal_values) else None


def _long_division_digits(v: Fraction, places: int) -> tuple[str, int]:
    """|v|'s decimal digits to ``places`` places, by exact long division,
    plus the remainder left over (whether the expansion continues)."""
    remainder = abs(v.numerator) % v.denominator
    digits: list[str] = []
    for _ in range(places):
        remainder *= 10
        digits.append(str(remainder // v.denominator))
        remainder %= v.denominator
    return "".join(digits), remainder


def _has_nonzero_digit_beyond(v: Fraction, places: int) -> bool:
    _, remainder = _long_division_digits(v, places)
    return remainder != 0


def _decimal_string(is_negative: bool, integer_part: int, fraction_digits: str) -> str:
    """Canonical decimal rendering: an integer part of 0 is dropped (``.999``,
    matching the O7 entry's own leading-zero-stripped form), any other
    integer part is kept in full (``1.000``, ``12.35``)."""
    sign = "-" if is_negative else ""
    if integer_part == 0:
        return f"{sign}.{fraction_digits}"
    return f"{sign}{integer_part}.{fraction_digits}"


def _truncate_toward_zero(v: Fraction, places: int) -> str:
    integer_part = abs(v.numerator) // v.denominator
    digits, _ = _long_division_digits(v, places)
    return _decimal_string(v < 0, integer_part, digits)


def _round_half_away_from_zero(v: Fraction, places: int) -> str:
    integer_part = abs(v.numerator) // v.denominator
    digits, remainder = _long_division_digits(v, places)
    next_digit = (remainder * 10) // v.denominator
    fraction_value = int(digits or "0") + (1 if next_digit >= 5 else 0)
    scale = 10**places
    if fraction_value >= scale:
        fraction_value -= scale
        integer_part += 1
    return _decimal_string(v < 0, integer_part, str(fraction_value).zfill(places))


def accepts_under_o7(keys: Iterable[str], answer: str) -> bool:
    """The O7 acceptance path in isolation (plan §4.3(d)), independent of
    (a)-(c) — ``is_correct`` only reaches this once those have all failed.
    Exposed separately (not just inlined into ``is_correct``) because the
    O7-only vectors in ``grading.json`` (``variant`` starting ``"o7_"``)
    are themselves captured this way, from ``acceptsUnderO7`` in
    ``tests/domain/sat/upstream/harness/lib/o7.ts`` — several of them
    would already be granted by (c) before O7 is ever reached, so they only
    mean what they claim when checked against this function directly."""
    v = _unambiguous_exact_value(keys)
    if v is None:
        return False

    trimmed = answer.strip()
    if not _O7_ENTRY_RE.match(trimmed):
        return False

    expected_len = _O7_NEGATIVE_FIELD_LEN if trimmed.startswith("-") else _O7_POSITIVE_FIELD_LEN
    if len(trimmed) != expected_len:
        return False

    decimal_places = len(trimmed) - trimmed.index(".") - 1
    if not _has_nonzero_digit_beyond(v, decimal_places):
        return False

    without_leading_zero = _O7_LEADING_ZERO_RE.sub(r"\1.", trimmed)
    return without_leading_zero in (
        _truncate_toward_zero(v, decimal_places),
        _round_half_away_from_zero(v, decimal_places),
    )
