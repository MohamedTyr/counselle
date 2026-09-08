"""Pure label/value normalization: the money/percent/count/decimal/bool/enum/
text/date/range/address/url/ordinal/table/matrix/distribution engine (plan
§4.4, node-type table in appendix E-i).

Every function here either returns a genuine `NormalizedValue` or raises
`NormalizeError` — it never returns `None` and never invents a value. Absence
("Not reported"/"Not available"/"—"/"") is detected up front by
`absence_display`, before any kind-specific normalizer runs; a mapper that
sees a non-`None` `absence_display` result stores no `NormalizedValue` at all
(§5.1 — "school_facts holds only labels actually observed"; an explicit
absence is real, but it is not a value).

`NormalizeError` (as opposed to absence) means the raw text matched neither
an absence marker nor its declared kind's shape — the mapper routes that
label to `unmapped:<source_path>` (§4.4) rather than coercing a best guess.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import date as _date
from typing import Literal

from pydantic import BaseModel, ConfigDict

from domain.envelope import JsonValue
from domain.facts.models import NormalizedValue

__all__ = [
    "AddressParts",
    "DistributionBucket",
    "NormalizeError",
    "absence_display",
    "normalize_address",
    "normalize_bool",
    "normalize_count",
    "normalize_date",
    "normalize_decimal",
    "normalize_distribution",
    "normalize_dual_merit",
    "normalize_enum",
    "normalize_list",
    "normalize_matrix",
    "normalize_money",
    "normalize_ordinal",
    "normalize_percent",
    "normalize_range",
    "normalize_table",
    "normalize_text",
    "normalize_url",
]


class NormalizeError(ValueError):
    """Raw text is neither an absence marker nor parseable by its declared kind."""


# ---------------------------------------------------------------------------
# Absence — one rule, checked before any kind-specific normalizer (§4.4).
# ---------------------------------------------------------------------------

_ABSENCE_TO_DISPLAY: dict[str, str] = {
    "": "Not reported",
    "-": "Not reported",
    "—": "Not reported",
    "not reported": "Not reported",
    "not available": "Not available",
}


def absence_display(raw: str | None) -> str | None:
    """The canonical display word if `raw` is an explicit absence marker, else `None`.

    Matches CollegeData's printed absence spellings case-insensitively (plus
    an empty string and a bare dash/em-dash), sentence-cased to the word the
    source actually printed — never a word the source did not use.
    """
    if raw is None:
        return "Not reported"
    return _ABSENCE_TO_DISPLAY.get(raw.strip().lower())


# ---------------------------------------------------------------------------
# Shared numeric parsing
# ---------------------------------------------------------------------------

_NUMBER_RE = re.compile(r"^-?\d[\d,]*(?:\.\d+)?$")


def _parse_number(text: str) -> float:
    cleaned = text.strip()
    if not _NUMBER_RE.match(cleaned):
        raise NormalizeError(f"not a numeric value: {text!r}")
    return float(cleaned.replace(",", ""))


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")
    if not slug:
        raise NormalizeError(f"cannot derive a code from: {text!r}")
    return slug


# ---------------------------------------------------------------------------
# Scalars
# ---------------------------------------------------------------------------


def normalize_money(raw: str, *, unit: str = "USD") -> NormalizedValue:
    """A dollar figure, e.g. `"$72,685"` or `"$0"` (a legitimate zero, not an absence)."""
    cleaned = raw.strip()
    body = cleaned[1:] if cleaned.startswith("$") else cleaned
    amount = _parse_number(body)
    return NormalizedValue(kind="money", display=cleaned, unit=unit, value_num=amount)


def normalize_percent(raw: str) -> NormalizedValue:
    """A percentage figure, e.g. `"99.4%"` or `"0%"`."""
    cleaned = raw.strip()
    body = cleaned[:-1] if cleaned.endswith("%") else cleaned
    pct = _parse_number(body)
    return NormalizedValue(kind="percent", display=cleaned, unit="percent", value_num=pct)


def normalize_count(raw: str, *, unit: str | None = None) -> NormalizedValue:
    """A whole-number figure, e.g. `"944"` or `"0"`."""
    cleaned = raw.strip()
    return NormalizedValue(
        kind="count", display=cleaned, unit=unit, value_num=_parse_number(cleaned)
    )


def normalize_decimal(raw: str, *, unit: str | None = None) -> NormalizedValue:
    """A fractional figure, e.g. required/recommended course units (`"4"`, `"2.5"`)."""
    cleaned = raw.strip()
    return NormalizedValue(
        kind="decimal", display=cleaned, unit=unit, value_num=_parse_number(cleaned)
    )


_BOOL_TRUE = {"yes", "true", "offered"}
_BOOL_FALSE = {"no", "false", "not offered"}


def normalize_bool(raw: str) -> NormalizedValue:
    """`"Yes"`/`"No"` (and the `applying.*_offered`/round vocabulary) as a real boolean.

    `"No"` produces `value_bool=False` — a real, present value at full
    weight, never treated as absent (plan §5.1).
    """
    cleaned = raw.strip()
    lowered = cleaned.lower()
    if lowered in _BOOL_TRUE:
        return NormalizedValue(kind="bool", display=cleaned, value_bool=True)
    if lowered in _BOOL_FALSE:
        return NormalizedValue(kind="bool", display=cleaned, value_bool=False)
    raise NormalizeError(f"not a bool value: {raw!r}")


def normalize_enum(raw: str) -> NormalizedValue:
    """A closed-vocabulary label, e.g. `"Available"` -> code `available`.

    The code is a generic slugify of the source's own text — this module
    does not own any particular vocabulary's closed member set (that is
    `facts_keys.yaml`'s job, per key); a caller enforcing a specific CHECK
    (e.g. `test_policy`'s four members) validates the returned `value_text`
    itself and raises `NormalizeError` (routing to `unmapped:`) on a miss.
    """
    cleaned = raw.strip()
    code = _slugify(cleaned)
    return NormalizedValue(kind="enum", display=cleaned, value_text=code, value={"raw": cleaned})


def normalize_text(raw: str) -> NormalizedValue:
    """Free text, verbatim (mascot names, phone numbers, list-joined program names)."""
    cleaned = raw.strip()
    if not cleaned:
        raise NormalizeError("empty text is an absence marker, not a value")
    return NormalizedValue(kind="text", display=cleaned, value_text=cleaned)


_URL_RE = re.compile(r"^https?://\S+$", re.IGNORECASE)
# A schemeless host CollegeData prints verbatim ("www.bmtc.edu/") -- a
# real, dotted hostname with an alphabetic final label (a TLD shape),
# optionally followed by a path/query, and never containing whitespace or
# an "@" (which would make it an email address, not a site). Rejects free
# text, phone numbers, and anything without a domain-like shape.
_SCHEMELESS_HOST_RE = re.compile(
    r"^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:/\S*)?$", re.IGNORECASE
)


def normalize_url(href: str, *, text: str | None = None) -> NormalizedValue:
    """A link; `display` is the link text when the source gives one, else the URL
    exactly as the source printed it -- schemeless hosts are accepted as valid
    (a school printing "www.example.edu/" is an ordinary way to publish a URL)
    but `display` is never rewritten. `value_text`, the functional link the
    frontend renders as `<a href>`, gets an `https://` scheme added when the
    source omitted one, since a browser resolves a bare `www.example.edu/`
    href as relative, not absolute -- storage needs a usable link, display
    needs a faithful one, and this is the one place they diverge."""
    cleaned = href.strip()
    if _URL_RE.match(cleaned):
        value_text = cleaned
    elif _SCHEMELESS_HOST_RE.match(cleaned):
        value_text = f"https://{cleaned}"
    else:
        raise NormalizeError(f"not a URL: {href!r}")
    display = (text or cleaned).strip() or cleaned
    return NormalizedValue(kind="url", display=display, value_text=value_text)


_MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def normalize_date(raw: str) -> NormalizedValue:
    """An ISO date (`"2027-01-02"`), the only date shape CollegeData emits verbatim.

    A bare month-day deadline ("November 1") is not an ISO date — it has no
    year of its own; see `period.py` for the cycle-year anchor/roll that
    resolves one to a real date.
    """
    cleaned = raw.strip()
    match = re.match(r"^(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})$", cleaned)
    if not match:
        raise NormalizeError(f"not an ISO date: {raw!r}")
    year, month, day = int(match["year"]), int(match["month"]), int(match["day"])
    if not 1 <= month <= 12:
        raise NormalizeError(f"not an ISO date: {raw!r}")
    display = f"{_MONTH_NAMES[month - 1]} {day}, {year}"
    try:
        value_date = _date(year, month, day)
    except ValueError as exc:
        raise NormalizeError(f"not a calendar date: {raw!r}") from exc
    return NormalizedValue(kind="date", display=display, value_date=value_date)


# ---------------------------------------------------------------------------
# Compound kinds
# ---------------------------------------------------------------------------

_RANGE_RE = re.compile(r"(?P<lo>-?[\d,]+(?:\.\d+)?)\s*[-–]\s*(?P<hi>-?[\d,]+(?:\.\d+)?)")


def normalize_range(raw: str, *, unit: str | None = None) -> NormalizedValue:
    """A two-ended range, e.g. `"740-790 range of middle 50%"` -> lo=740, hi=790."""
    match = _RANGE_RE.search(raw)
    if not match:
        raise NormalizeError(f"not a range: {raw!r}")
    lo = float(match["lo"].replace(",", ""))
    hi = float(match["hi"].replace(",", ""))
    return NormalizedValue(
        kind="range", display=raw.strip(), unit=unit, value={"lo": lo, "hi": hi}
    )


class AddressParts(BaseModel):
    """One postal address, however the source shaped it (header dict or body array)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    street1: str
    street2: str | None = None
    city: str
    state: str
    zip: str


def normalize_address(parts: AddressParts) -> NormalizedValue:
    lines = [parts.street1] + ([parts.street2] if parts.street2 else [])
    one_line = f"{', '.join(lines)}, {parts.city}, {parts.state} {parts.zip}"
    return NormalizedValue(
        kind="address",
        display=one_line,
        value={
            "street1": parts.street1,
            "street2": parts.street2,
            "city": parts.city,
            "state": parts.state,
            "zip": parts.zip,
        },
    )


def normalize_ordinal(levels: Sequence[str], marked_index: int) -> NormalizedValue:
    """One row of an importance-scale `LabeledTable` — exactly one column marked.

    `value_num` is the rank index (0 = least important), the ordinal's one
    typed column; the source's own level strings (slugified) live in `value`.
    """
    if not levels:
        raise NormalizeError("ordinal levels must be non-empty")
    if not 0 <= marked_index < len(levels):
        raise NormalizeError(f"marked index {marked_index} out of range for {len(levels)} levels")
    codes = [_slugify(level) for level in levels]
    levels_json: list[JsonValue] = list(codes)
    return NormalizedValue(
        kind="ordinal",
        display=levels[marked_index].strip(),
        value_num=float(marked_index),
        value={"code": codes[marked_index], "levels": levels_json},
    )


def normalize_table(rows: Sequence[Mapping[str, JsonValue]], *, row_noun: str) -> NormalizedValue:
    """A generic `LabeledTable` that is neither an ordinal scale nor an icon matrix."""
    if not rows:
        raise NormalizeError("a table must have at least one row")
    return NormalizedValue(
        kind="table",
        display=f"{len(rows)} {row_noun}",
        value={"rows": [dict(row) for row in rows]},
    )


def normalize_matrix(
    rows: Sequence[Mapping[str, bool | None]], *, row_labels: Sequence[str], row_noun: str
) -> NormalizedValue:
    """An `IconTable` (sports offered/scholarship grid): one list fact for the whole table.

    A `None` cell is `False` ("not offered") — CollegeData's icon grid has no
    third state, per §4.4's node table.
    """
    if len(rows) != len(row_labels):
        raise NormalizeError("rows and row_labels must have matching length")
    matrix_rows: list[JsonValue] = [
        {"label": label, **{column: bool(value) for column, value in row.items()}}
        for label, row in zip(row_labels, rows, strict=True)
    ]
    return NormalizedValue(
        kind="matrix",
        display=f"{len(matrix_rows)} {row_noun}",
        value_num=float(len(matrix_rows)),
        value={"rows": matrix_rows},
    )


class DistributionBucket(BaseModel):
    """One bucket of a `BarGraph` distribution (plan §4.4's D10 shape)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    label: str
    lo: float | None = None
    hi: float | None = None
    pct: float | None = None
    absence: Literal["not_reported"] | None = None


_BUCKET_RANGE_RE = re.compile(r"^(?P<lo>-?[\d,]+(?:\.\d+)?)\s*[-–]\s*(?P<hi>-?[\d,]+(?:\.\d+)?)$")


def _bucket_range(label: str) -> tuple[float, float] | None:
    match = _BUCKET_RANGE_RE.match(label.strip())
    if not match:
        return None
    return float(match["lo"].replace(",", "")), float(match["hi"].replace(",", ""))


def normalize_distribution(
    raw_buckets: Sequence[tuple[str, float]],
    *,
    scale: str,
    unit: str,
    all_labels: Sequence[str] | None = None,
) -> NormalizedValue:
    """A `BarGraph`'s buckets, as published.

    `raw_buckets` is exactly what the source printed for this school (label,
    pct-or-`-1`); `all_labels`, when given, is the graph type's full bucket
    schema — a label present there but absent from `raw_buckets` is listed in
    `omitted_buckets`, **never invented as 0** (plan §4.4/§5.1). A `-1` bucket
    is present but marked `absence: "not_reported"`, distinct from omission.
    """
    if not raw_buckets:
        raise NormalizeError("a distribution must have at least one bucket")
    buckets: list[DistributionBucket] = []
    seen: set[str] = set()
    for label, raw_pct in raw_buckets:
        seen.add(label)
        lo, hi = _bucket_range(label) or (None, None)
        if raw_pct < 0:
            buckets.append(DistributionBucket(label=label, lo=lo, hi=hi, absence="not_reported"))
        else:
            buckets.append(DistributionBucket(label=label, lo=lo, hi=hi, pct=raw_pct))
    omitted: list[JsonValue] = [label for label in (all_labels or ()) if label not in seen]
    reported = [bucket.pct for bucket in buckets if bucket.pct is not None]
    sums_to = round(sum(reported), 1) if reported else None
    total = len(all_labels) if all_labels else len(buckets)
    bucket_json: list[JsonValue] = [bucket.model_dump(exclude_none=True) for bucket in buckets]
    return NormalizedValue(
        kind="distribution",
        display=f"{len(buckets)} of {total} buckets reported",
        unit=unit,
        value={
            "scale": scale,
            "buckets": bucket_json,
            "omitted_buckets": omitted,
            "sums_to": sums_to,
        },
    )


def normalize_list(items: Sequence[str]) -> NormalizedValue:
    """A plain list of names (special programs, majors, sports) — one fact for the whole list."""
    cleaned = [item.strip() for item in items if item.strip()]
    if not cleaned:
        raise NormalizeError("a list must have at least one item")
    items_json: list[JsonValue] = list(cleaned)
    return NormalizedValue(kind="list", display=", ".join(cleaned), value={"items": items_json})


# ---------------------------------------------------------------------------
# dual_merit — parsed by sentence pattern, never by array position (§4.4)
# ---------------------------------------------------------------------------

_DUAL_MERIT_RE = re.compile(r"(?P<lead>[\d,.]+%?)[^$%\d]+\$(?P<amount>[\d,]+(?:\.\d+)?)")


def normalize_dual_merit(raw: str) -> tuple[NormalizedValue, NormalizedValue]:
    """Parse a merit-aid sentence into its two facts: how many/what share, and the average award.

    E.g. `"38% of students without need received merit aid averaging $18,450"`
    -> a percent fact (38%) and a money fact ($18,450). CollegeData packs
    this as one free-text value whose two numbers can each independently be
    absent — parsing by pattern (not by splitting an array on position, which
    the plan explicitly rejects for this key) means a sentence missing one
    clause never silently shifts the other number into the wrong fact.
    """
    match = _DUAL_MERIT_RE.search(raw)
    if not match:
        raise NormalizeError(f"not a dual_merit sentence: {raw!r}")
    lead_raw = match["lead"]
    lead = normalize_percent(lead_raw) if lead_raw.endswith("%") else normalize_count(lead_raw)
    amount = normalize_money(f"${match['amount']}")
    return lead, amount
