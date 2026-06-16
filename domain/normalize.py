"""The normalization engine — DATABASE_GUIDE §6 (reading rules R1-R12) as code.

``normalize(meta, value, decode_map)`` turns a raw jsonb payload (already
json-decoded to a Python object by the DB layer) into a display-ready
``NormalizedValue``. Data weirdness NEVER raises — it degrades honestly to
``available=False, display="not available"``. Exceptions are reserved for
programmer error (a ``None`` meta).

Selection rules vs transforms: **R11** (FTE ≠ headcount — pick
``enrollment.undergrad_total`` / ``enrollment.total_headcount``, never
``enrollment.fte``) and **R12** (``schools.control`` is decoded text; prefer it
over the coded ``institution.control`` field_value) are *selection* rules. They
live in the dossier shortlist asset (``config/assets/dossier_shortlist.yaml``)
and in :data:`SOURCE_PREFERENCE` below — not as value transforms here.
"""

import re
from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from pydantic import BaseModel

from domain.envelope import Unit

NOT_AVAILABLE = "not available"

_BENCHMARK_CAVEAT = "National benchmark across all institutions — not this school's own value."

_SYSTEM_NAME_KEY = "institution.system_name"
_SYSTEM_NAME_SENTINEL = "-2"

_BBRR_KEY_RE = re.compile(r"^outcomes\.bbrr")
_PLAIN_DECIMAL_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
_BBRR_LE_TOKEN_RE = re.compile(r"^<=?\s*(\d+(?:\.\d+)?)$")
_BBRR_RANGE_TOKEN_RE = re.compile(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$")
_URL_KEY_SUFFIXES = (".website", ".admissions_url")
_URL_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)


class FieldMeta(BaseModel):
    """The ``public.fields`` columns the engine needs to read a value."""

    key: str
    label: str
    category: str | None = None
    data_type: Literal["int", "number", "percent", "currency", "text", "bool", "date", "json"]
    source: Literal["ipeds", "scorecard", "cds"]
    raw_table: str | None = None
    raw_column: str | None = None


class NormalizedValue(BaseModel):
    """A decoded, scaled, display-ready value — what the envelope is built from."""

    display: str
    raw: float | int | bool | str | None = None
    available: bool
    unit: Unit | None = None
    decoded_label: str | None = None
    extra_caveat: str | None = None  # e.g. the national-benchmark warning


#: R9 — source preference per concept (DATABASE_GUIDE §6 table). Order = preference.
#: Median earnings deliberately NEVER lists ``*_all_institutions`` (national benchmark).
SOURCE_PREFERENCE: dict[str, tuple[str, ...]] = {
    "acceptance_rate": ("admissions.acceptance_rate", "admissions.admit_rate_total"),
    "undergrad_enrollment": ("enrollment.undergrad_total", "enrollment.total_undergrad"),
    "median_earnings": (
        "earnings.median_4yr_postcompletion",
        "earnings.median_10yr",
        "earnings.median_6yr",
    ),
    "test_policy": ("cds.c8a_test_policy", "admissions.req_test_scores"),
    "hbcu": ("institution.hbcu", "institution.is_hbcu"),
}


def preferred_field(concept: str) -> list[str]:
    """The R9 field-key preference order for a concept (empty if unknown)."""
    return list(SOURCE_PREFERENCE.get(concept, ()))


def normalize(
    meta: FieldMeta, value: Any, decode_map: Mapping[str, str] | None = None
) -> NormalizedValue:
    """Apply the reading rules to one raw value. Never raises on data weirdness."""
    if meta is None:  # programmer error, not data weirdness
        raise TypeError("normalize() requires a FieldMeta")
    try:
        result = _dispatch(meta, value, decode_map)
    except Exception:  # noqa: BLE001 — any data weirdness degrades honestly
        result = _not_available()
    if result.available and "_all_institutions" in meta.key:  # R9 benchmark guard
        result = result.model_copy(update={"extra_caveat": _BENCHMARK_CAVEAT})
    return result


def _dispatch(meta: FieldMeta, value: Any, decode_map: Mapping[str, str] | None) -> NormalizedValue:
    if value is None:  # R3 — NULL and missing-row are the same honest answer
        return _not_available()
    match meta.data_type:
        case "percent":
            return _percent(value)
        case "currency":
            return _currency(value)
        case "int":
            return _int(value, decode_map)
        case "number":
            return _number(value)
        case "bool":
            return _bool(value)
        case "text":
            return _text(meta, value)
        case "date":
            return _date(value)
        case _:  # "json" and anything unknown: no display rule -> honest degrade
            return _not_available()


def _not_available() -> NormalizedValue:
    return NormalizedValue(display=NOT_AVAILABLE, raw=None, available=False, unit=None)


def _decimal(value: Any) -> Decimal:
    """Parse a numeric scalar strictly: bools, non-finites and blobs raise."""
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        raise ValueError(f"not a numeric scalar: {value!r}")
    parsed = Decimal(str(value))
    if not parsed.is_finite():
        raise ValueError(f"non-finite number: {value!r}")
    return parsed


def _strip_trailing_point_zero(text: str) -> str:
    return text.removesuffix(".0")


def _fraction_as_percent(fraction: Decimal) -> str:
    """0-1 fraction -> percent with one decimal, trailing .0 stripped (R2)."""
    scaled = (fraction * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return f"{_strip_trailing_point_zero(str(scaled))}%"


#: A percent is a 0–1 fraction (DATABASE_GUIDE §6, max 1.0). Generous slack for
#: rounding; beyond this it's pipeline drift (a raw "45" stored where a 0.45
#: fraction belongs) — degrade rather than render "4500%". ``_currency`` is left
#: intentionally unbounded: negative net price is valid (R5) and there is no sane
#: symmetric dollar bound, so a wrong-but-plausible dollar figure is far less
#: misleading than "4500%".
_MAX_PERCENT_FRACTION = Decimal("1.5")


def _percent(value: Any) -> NormalizedValue:
    fraction = _decimal(value)
    if fraction < 0 or fraction > _MAX_PERCENT_FRACTION:
        # Out of the 0–1 fraction contract ⇒ unknowable, not a real percent.
        return _not_available()
    return NormalizedValue(
        display=_fraction_as_percent(fraction),
        raw=value if isinstance(value, int | float) else float(fraction),
        available=True,
        unit="percent",
    )


def _currency(value: Any) -> NormalizedValue:
    dollars = int(_decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))  # R5
    display = f"-${abs(dollars):,}" if dollars < 0 else f"${dollars:,}"
    return NormalizedValue(
        display=display,
        raw=value if isinstance(value, int | float) else float(dollars),
        available=True,
        unit="currency",
    )


def _int(value: Any, decode_map: Mapping[str, str] | None) -> NormalizedValue:
    count = int(_decimal(value).to_integral_value(rounding=ROUND_HALF_UP))  # R6
    if decode_map is not None:
        # R1 — the field IS coded. Decode it, or degrade: an unknown code is
        # "unknown", never a count. Showing the raw integer (e.g. control: 2)
        # is exactly the misread R1 exists to prevent.
        label = decode_map.get(str(count))
        if label is None:
            return _not_available()
        return NormalizedValue(
            display=label, raw=count, available=True, unit="count", decoded_label=label
        )
    # Uncoded int (counts/scores/ratios) — display as a plain number.
    return NormalizedValue(display=f"{count:,}", raw=count, available=True, unit="count")


def _number(value: Any) -> NormalizedValue:
    parsed = _decimal(value)
    quantized = parsed.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if quantized == 0 and parsed != 0:
        # A real sub-cent value must never display as a flat "0" — keep precision.
        quantized = parsed.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    display = f"{quantized:,f}"
    if "." in display:
        display = display.rstrip("0").rstrip(".")
    return NormalizedValue(
        display=display,
        raw=value if isinstance(value, int | float) else float(quantized),
        available=True,
        unit="number",
    )


def _bool(value: Any) -> NormalizedValue:
    if not isinstance(value, bool):
        raise ValueError(f"not a native bool: {value!r}")
    return NormalizedValue(display="Yes" if value else "No", raw=value, available=True, unit="bool")


def _date(value: Any) -> NormalizedValue:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"not a date string: {value!r}")
    return NormalizedValue(display=value.strip(), raw=value, available=True, unit="date")


def _is_bbrr(meta: FieldMeta) -> bool:
    return bool((meta.raw_column or "").startswith("BBRR") or _BBRR_KEY_RE.match(meta.key))


def _bbrr(text: str) -> NormalizedValue:
    """R4 — BBRR fields mix exact decimal strings and privacy-range tokens.

    Tokens render as approximate ranges with NO arithmetic, ever (raw=None).
    """
    if _PLAIN_DECIMAL_RE.fullmatch(text):
        return NormalizedValue(
            display=_fraction_as_percent(Decimal(text)),
            raw=float(text),
            available=True,
            unit="percent",
        )
    le_token = _BBRR_LE_TOKEN_RE.fullmatch(text)
    if le_token:
        bound = _fraction_as_percent(Decimal(le_token.group(1)))
        return NormalizedValue(
            display=f"≤ {bound} (reported as a range)", raw=None, available=True, unit="percent"
        )
    range_token = _BBRR_RANGE_TOKEN_RE.fullmatch(text)
    if range_token:
        low = _fraction_as_percent(Decimal(range_token.group(1)))
        high = _fraction_as_percent(Decimal(range_token.group(2)))
        return NormalizedValue(
            display=f"{low}–{high} (reported as a range)", raw=None, available=True, unit="percent"
        )
    raise ValueError(f"unrecognized BBRR token: {text!r}")


def _fix_url(text: str) -> str:
    """R8 — prepend https:// (never http://) when no scheme is present.

    Values that already carry a scheme — including the rare stored ``http://`` —
    pass through unchanged; the rule governs only what we *add*.
    """
    return text if _URL_SCHEME_RE.match(text) else f"https://{text}"


def _looks_like_url(meta: FieldMeta, text: str) -> bool:
    return (
        meta.key.endswith(_URL_KEY_SUFFIXES)
        or text.startswith("www.")
        or bool(_URL_SCHEME_RE.match(text))
    )


def _text(meta: FieldMeta, value: Any) -> NormalizedValue:
    if not isinstance(value, str):
        raise ValueError(f"not a text value: {value!r}")
    text = value.strip()
    if not text:
        raise ValueError("empty text")
    if meta.key == _SYSTEM_NAME_KEY and text == _SYSTEM_NAME_SENTINEL:  # R4 sentinel
        return NormalizedValue(
            display="Not part of a system", raw=None, available=True, unit="text"
        )
    if _is_bbrr(meta):
        return _bbrr(text)
    if _looks_like_url(meta, text):  # R8 — before the CDS branch: never mangle a URL
        return NormalizedValue(display=_fix_url(text), raw=value, available=True, unit="text")
    if meta.source == "cds":  # R7 — light formatting only, no decode
        spaced = text.replace("_", " ")
        return NormalizedValue(
            display=spaced[0].upper() + spaced[1:], raw=value, available=True, unit="text"
        )
    return NormalizedValue(display=text, raw=value, available=True, unit="text")
