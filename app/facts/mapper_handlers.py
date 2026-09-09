"""Per-shape handlers for `app/facts/mapper.py` (plan §4.4, appendix E-i).

Every handler returns a list of `MappedFact` — a fully-formed `fact_key`
(the handler builds it itself, usually from a `base_key` the caller passes
in) paired with a `NormalizedValue | None` and an optional reported period.
Building the complete key inside the handler (rather than the engine
concatenating a generic "suffix") is deliberate: several real shapes here
produce facts whose names do not share a common stem (`students.
international_pct` / `students.countries_represented` from one compound
`TitleValue`, for instance) so a single suffix-onto-base convention would
not fit every case; one uniform contract is simpler than two.

Every handler checks `normalize.absence_display` before attempting its own
shape-specific parse (plan §4.4: absence is one rule, checked up front) and
never raises `NormalizeError` past its own boundary — a raw value that is
neither an absence marker nor shaped as expected degrades to a plain `text`
value (still shown to the student) rather than becoming `unmapped:` for a
label the mapper *did* recognize. Genuinely unrecognized labels are the
engine's job (`mapper.py`), not this module's.
"""

from __future__ import annotations

import contextlib
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from adapters.collegedata.parse import WalkedNode
from domain.envelope import JsonValue
from domain.facts import normalize as N
from domain.facts import period as P
from domain.facts.models import NormalizedValue
from domain.facts.normalize import AddressParts, NormalizeError, absence_display

__all__ = [
    "MappedFact",
    "address_from_body_array",
    "address_from_header_dict",
    "admission_rate_group",
    "bar_graph_distribution",
    "compound_countries",
    "dual_merit_pair",
    "enrolled_group",
    "labelled_pairs",
    "leading_percent",
    "list_value",
    "merit_based_gift",
    "nested_award",
    "nested_list_count",
    "paired_header",
    "scalar",
    "student_body_group",
    "text_fallback_date",
    "title_link_text",
    "title_link_url",
    "to_str_list",
]


@dataclass(frozen=True, slots=True)
class MappedFact:
    """One fully-keyed fact a handler produced."""

    fact_key: str
    value: NormalizedValue | None
    reported_period: str | None = None
    reported_period_year: int | None = None


def _single(raw_list: JsonValue) -> str:
    """The one and only element of a `TitleValueData.value`-shaped array —
    every real capture is a `list[str]` (parse.py's own docstring), but the
    type is `JsonValue` at this boundary, so narrow and validate here rather
    than trusting the caller."""
    if not isinstance(raw_list, list) or len(raw_list) != 1 or not isinstance(raw_list[0], str):
        raise NormalizeError(f"expected exactly one string value, got {raw_list!r}")
    return raw_list[0]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")


def to_str_list(raw: JsonValue) -> list[str] | None:
    """A `WalkedNode.raw` value narrowed to `list[str]`, or `None` if it
    isn't shaped that way — every real `TitleValue`/`NestedTitleValue`
    array observed across the fixture corpus already is; a caller that gets
    `None` back treats it as absence rather than crashing on a
    hypothetical malformed capture. Shared with `app/facts/mapper.py`."""
    if isinstance(raw, list) and all(isinstance(item, str) for item in raw):
        return [item for item in raw if isinstance(item, str)]
    return None


def _pct(raw_number: str) -> NormalizedValue:
    """`normalize_percent` requires a leading digit; a captured group like
    `".4"` (real data: Yale's merit-aid sentence prints `24(.4%)of ...`)
    needs a `0` prepended before it round-trips."""
    text = raw_number.strip()
    if text.startswith("."):
        text = f"0{text}"
    return N.normalize_percent(f"{text}%")


# ---------------------------------------------------------------------------
# Scalars — the generic TitleValue/TitleLink/header dispatch
# ---------------------------------------------------------------------------

_SCALAR_PARSERS: Mapping[str, Callable[[str], NormalizedValue]] = {
    "money": N.normalize_money,
    "percent": N.normalize_percent,
    "count": N.normalize_count,
    "decimal": N.normalize_decimal,
    "bool": N.normalize_bool,
    "enum": N.normalize_enum,
    "text": N.normalize_text,
    "date": N.normalize_date,
    "url": N.normalize_url,
}


def scalar(raw: str, *, base_key: str, kind: str) -> list[MappedFact]:
    """The common case: one label, one value, a fixed `kind` (plan §4.4's scalar row)."""
    absence = absence_display(raw)
    if absence is not None:
        return [MappedFact(base_key, None)]
    parser = _SCALAR_PARSERS[kind]
    try:
        return [MappedFact(base_key, parser(raw))]
    except NormalizeError:
        return [MappedFact(base_key, N.normalize_text(raw))]


_TITLE_PREFIX_RE = re.compile(r"^(?:ACT Math|ACT Eng|SAT Math|SAT EBRW):\s*", re.IGNORECASE)
_TITLE_RANGE_RE = re.compile(
    r"(?P<lo>[\d,]+)\s*-\s*(?P<hi>[\d,]+)\s*range of middle 50%", re.IGNORECASE
)
_TITLE_AVG_RE = re.compile(r"(?P<avg>[\d.]+)\s*average", re.IGNORECASE)
_TITLE_BARE_NUMBER_RE = re.compile(r"^\s*(?P<avg>[\d.]+)\s*$")


def _bar_graph_buckets(raw: JsonValue) -> list[tuple[str, float]]:
    if not isinstance(raw, list):
        return []
    buckets: list[tuple[str, float]] = []
    for bucket in raw:
        if not isinstance(bucket, dict):
            continue
        label, value = bucket.get("label"), bucket.get("value")
        if (
            isinstance(label, str)
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
        ):
            buckets.append((label, float(value)))
    return buckets


def bar_graph_distribution(
    node: WalkedNode, *, base_key: str, scale: str, unit: str
) -> list[MappedFact]:
    """A `BarGraph` -> its `distribution` fact, plus any p25/p75/avg scalars
    embedded in the graph's own title (plan §4.4's worked example: a title
    with an `ACT Math:`/`ACT Eng:` prefix routes to the subscore, one with no
    prefix — including `''` and `'Not reported'` — routes to the composite;
    caller picks `base_key` accordingly, this function only extracts).
    """
    buckets = _bar_graph_buckets(node.raw)
    facts: list[MappedFact] = []
    if buckets:
        with contextlib.suppress(NormalizeError):
            facts.append(
                MappedFact(
                    f"{base_key}_distribution",
                    N.normalize_distribution(buckets, scale=scale, unit=unit),
                )
            )
    stripped = _TITLE_PREFIX_RE.sub("", node.label).strip()
    range_match = _TITLE_RANGE_RE.search(stripped)
    if range_match:
        facts.append(MappedFact(f"{base_key}_p25", N.normalize_count(range_match["lo"])))
        facts.append(MappedFact(f"{base_key}_p75", N.normalize_count(range_match["hi"])))
    avg_match = _TITLE_AVG_RE.search(stripped) or _TITLE_BARE_NUMBER_RE.match(stripped)
    if avg_match:
        facts.append(MappedFact(f"{base_key}_avg", N.normalize_count(avg_match["avg"])))
    return facts


def text_fallback_date(raw: str, *, base_key: str, cycle_year: int | None) -> list[MappedFact]:
    """A bare month-day deadline/date field: anchor when possible, else plain text.

    Absence first; then `"2027-01-02"`-shaped ISO dates; then a bare
    month-day rolled onto `cycle_year` (plan §4.4's year-roll rule); anything
    else (a real but oddly-shaped string like a bare month name, observed
    live at UGA's "Due in Admissions Office" column) survives as text rather
    than becoming unmapped for a label the mapper recognized.
    """
    absence = absence_display(raw)
    if absence is not None:
        return [MappedFact(base_key, None)]
    try:
        return [MappedFact(base_key, N.normalize_date(raw))]
    except NormalizeError:
        pass
    month_day = P.parse_bare_month_day(raw)
    if month_day is not None and cycle_year is not None:
        month, day = month_day
        resolved = P.resolve_deadline_date(month, day, cycle_year)
        period = P.deadline_reported_period(cycle_year)
        value = NormalizedValue(kind="date", display=raw.strip(), value_date=resolved)
        return [
            MappedFact(base_key, value, reported_period=period, reported_period_year=cycle_year - 1)
        ]
    return [MappedFact(base_key, N.normalize_text(raw))]


def list_value(items: Sequence[str], *, base_key: str) -> list[MappedFact]:
    """A plain comma-style list value (special programs, loan programs, ...)."""
    if len(items) == 1:
        absence = absence_display(items[0])
        if absence is not None:
            return [MappedFact(base_key, None)]
    try:
        return [MappedFact(base_key, N.normalize_list(list(items)))]
    except NormalizeError:
        return [MappedFact(base_key, None)]


# ---------------------------------------------------------------------------
# Header-only shapes
# ---------------------------------------------------------------------------


def paired_header(pair: Sequence[str], *, base_key: str) -> list[MappedFact]:
    """A `[in_state, out_of_state]` header array (plan §4.4's 2-array header rule)."""
    if len(pair) != 2:
        raise NormalizeError(f"expected a 2-element paired header value, got {pair!r}")
    out = []
    for suffix, raw in zip(("in_state", "out_of_state"), pair, strict=True):
        absence = absence_display(raw)
        value = None if absence is not None else N.normalize_money(raw)
        out.append(MappedFact(f"{base_key}_{suffix}", value))
    return out


def address_from_header_dict(
    address: Mapping[str, JsonValue], *, base_key: str
) -> list[MappedFact]:
    """The header's `address`/`admission.address` dict shape."""
    street1, city, state = address.get("street1"), address.get("city"), address.get("state")
    if not (isinstance(street1, str) and isinstance(city, str) and isinstance(state, str)):
        return []
    street2, zip_code = address.get("street2"), address.get("zipCode")
    parts = AddressParts(
        street1=street1,
        street2=street2 if isinstance(street2, str) else None,
        city=city,
        state=state,
        zip=zip_code if isinstance(zip_code, str) else "",
    )
    return [MappedFact(base_key, N.normalize_address(parts))]


def title_link_url(link_data: Mapping[str, JsonValue], *, base_key: str) -> list[MappedFact]:
    """A `TitleLink` whose `link` is a real URL (Website, Net Price
    Calculator, Campus Map, Electronic Application). `link == "Not reported"`
    is an absence (appendix E-i's TitleLink row)."""
    link, text = link_data.get("link"), link_data.get("text")
    if not isinstance(link, str):
        return [MappedFact(base_key, None)]
    absence = absence_display(link)
    if absence is not None:
        return [MappedFact(base_key, None)]
    try:
        return [
            MappedFact(
                base_key, N.normalize_url(link, text=text if isinstance(text, str) else None)
            )
        ]
    except NormalizeError:
        return [
            MappedFact(
                base_key, N.normalize_text(text) if isinstance(text, str) and text.strip() else None
            )
        ]


def title_link_text(link_data: Mapping[str, JsonValue], *, base_key: str) -> list[MappedFact]:
    """A `TitleLink` used to carry plain text, not a real link (money-matters'
    "Email" row: `link=""`, the address lives in `text`)."""
    text = link_data.get("text")
    if not isinstance(text, str):
        return [MappedFact(base_key, None)]
    absence = absence_display(text)
    if absence is not None:
        return [MappedFact(base_key, None)]
    return [MappedFact(base_key, N.normalize_text(text))]


def address_from_body_array(raw: Sequence[str], *, base_key: str) -> list[MappedFact]:
    """The body's 4-element `[street, city, state, zip]` address array."""
    if len(raw) != 4:
        raise NormalizeError(f"expected a 4-element address array, got {raw!r}")
    street1, city, state, zip_code = raw
    parts = AddressParts(street1=street1, city=city, state=state, zip=zip_code)
    return [MappedFact(base_key, N.normalize_address(parts))]


# ---------------------------------------------------------------------------
# Sentence patterns (never positional splitting — plan §4.4)
# ---------------------------------------------------------------------------

_ADMIT_RATE_RE = re.compile(
    r"(?P<pct>[\d.]+)%\s*of\s+(?P<total>[\d,]+)\s+applicants\s+were\s+admitted", re.IGNORECASE
)
_ENROLLED_RE = re.compile(
    r"(?P<enrolled>[\d,]+)\s*\((?P<pct>[\d.]+)%\)\s*of\s+(?P<admitted>[\d,]+)\s+admitted\s+students\s+enrolled",
    re.IGNORECASE,
)
_DIMENSION_SUFFIX: Mapping[str, str] = {"women": "_women", "men": "_men"}


def _dimension_of(label: str) -> str:
    return _DIMENSION_SUFFIX.get(_slug(label), f"_{_slug(label)}")


def admission_rate_group(group: Sequence[WalkedNode]) -> list[MappedFact]:
    """The "Overall Admission Rate" NestedTitleValue (+ Women/Men children):
    `"5% of 50,264 applicants were admitted"` -> admit_rate + applicants_total
    per (parent/dimension). Deliberately never derives `admitted_total` here
    — the honest source for that is
    `enrolled_group`'s own explicit count.
    """
    facts: list[MappedFact] = []
    for i, node in enumerate(group):
        dim = "" if i == 0 else _dimension_of(node.label)
        raw = _single(node.raw)
        absence = absence_display(raw)
        if absence is not None:
            facts.append(MappedFact(f"admissions.admit_rate{dim}", None))
            facts.append(MappedFact(f"admissions.applicants_total{dim}", None))
            continue
        match = _ADMIT_RATE_RE.search(raw)
        if not match:
            facts.append(MappedFact(f"admissions.admit_rate{dim}", N.normalize_text(raw)))
            continue
        facts.append(MappedFact(f"admissions.admit_rate{dim}", _pct(match["pct"])))
        facts.append(
            MappedFact(f"admissions.applicants_total{dim}", N.normalize_count(match["total"]))
        )
    return facts


def enrolled_group(group: Sequence[WalkedNode]) -> list[MappedFact]:
    """The "Students Enrolled" NestedTitleValue (+ Women/Men children):
    `"1,657 (69%) of 2,387 admitted students enrolled"` ->
    enrolled_total + yield_rate + admitted_total per (parent/dimension)."""
    facts: list[MappedFact] = []
    for i, node in enumerate(group):
        dim = "" if i == 0 else _dimension_of(node.label)
        raw = _single(node.raw)
        absence = absence_display(raw)
        if absence is not None:
            for metric in ("enrolled_total", "yield_rate", "admitted_total"):
                facts.append(MappedFact(f"admissions.{metric}{dim}", None))
            continue
        match = _ENROLLED_RE.search(raw)
        if not match:
            facts.append(MappedFact(f"admissions.enrolled_total{dim}", N.normalize_text(raw)))
            continue
        facts.append(
            MappedFact(f"admissions.enrolled_total{dim}", N.normalize_count(match["enrolled"]))
        )
        facts.append(MappedFact(f"admissions.yield_rate{dim}", _pct(match["pct"])))
        facts.append(
            MappedFact(f"admissions.admitted_total{dim}", N.normalize_count(match["admitted"]))
        )
    return facts


_LEADING_PCT_RE = re.compile(r"^(?P<pct>[\d.]+)%")


def leading_percent(raw: str, *, base_key: str) -> list[MappedFact]:
    """`"36% of women participate"` / `"77% of all students"` -> one percent fact.

    `display` keeps the full sentence; only the leading number is parsed.
    """
    absence = absence_display(raw)
    if absence is not None:
        return [MappedFact(base_key, None)]
    match = _LEADING_PCT_RE.match(raw.strip())
    if not match:
        return [MappedFact(base_key, N.normalize_text(raw))]
    value = NormalizedValue(
        kind="percent", display=raw.strip(), unit="percent", value_num=float(match["pct"])
    )
    return [MappedFact(base_key, value)]


_COMPOUND_COUNTRIES_RE = re.compile(
    r"^(?P<pct>[\d.]+)%\s+from\s+(?P<n>[\d,]+)\s+countries", re.IGNORECASE
)


def compound_countries(raw: str, *, pct_key: str, count_key: str) -> list[MappedFact]:
    """`"1.3% from 90 countries"` -> international_pct + countries_represented;
    a plain `"10.6%"` (no countries clause) -> international_pct alone."""
    absence = absence_display(raw)
    if absence is not None:
        return [MappedFact(pct_key, None)]
    match = _COMPOUND_COUNTRIES_RE.match(raw.strip())
    if match:
        return [
            MappedFact(pct_key, _pct(match["pct"])),
            MappedFact(count_key, N.normalize_count(match["n"])),
        ]
    try:
        return [MappedFact(pct_key, N.normalize_percent(raw))]
    except NormalizeError:
        return [MappedFact(pct_key, N.normalize_text(raw))]


_LABEL_KEYWORDS: Mapping[str, str] = {
    "top tenth": "top_tenth",
    "top quarter": "top_quarter",
    "top half": "top_half",
}


def labelled_pairs(raw_list: Sequence[str], *, base_key: str) -> list[MappedFact]:
    """`["Top tenth:   97%", "Top quarter:   99%", "Top half:  100%"]` -> 3 percent facts."""
    facts: list[MappedFact] = []
    for item in raw_list:
        label_part, _, value_part = item.partition(":")
        suffix = _LABEL_KEYWORDS.get(label_part.strip().lower())
        if suffix is None:
            continue
        key = f"{base_key}_{suffix}"
        absence = absence_display(value_part)
        if absence is not None:
            facts.append(MappedFact(key, None))
            continue
        try:
            facts.append(MappedFact(key, N.normalize_percent(value_part)))
        except NormalizeError:
            facts.append(MappedFact(key, N.normalize_text(value_part.strip())))
    return facts


_MERIT_TO_NEED_RE = re.compile(
    r"^Received by\s+(?P<n>[\d,]+)\s*\(\s*(?P<pct>[\d.]+)%\s*\)\s*of\s+aid\s+recipients",
    re.IGNORECASE,
)
_MERIT_NO_NEED_RE = re.compile(
    r"(?P<n>[\d,]+)\s*\(\s*(?P<pct>[\d.]+)%\s*\)\s*of\s+\S+\s+had\s+no\s+financial\s+need.*?\$(?P<amount>[\d,]+)",
    re.IGNORECASE | re.DOTALL,
)


def merit_based_gift(raw_list: Sequence[str], *, population: str) -> list[MappedFact]:
    """`["Received by N (P%) of aid recipients", "M (Q%) of ... no financial need ... $X"]`
    (plan's `dual_merit` value_shape) — routed by each element's own wording,
    never by array position (element order varies across schools' captures)."""
    facts: list[MappedFact] = []
    for item in raw_list:
        if absence_display(item) is not None:
            continue
        to_need = _MERIT_TO_NEED_RE.search(item)
        if to_need:
            facts.append(
                MappedFact(
                    f"aid.merit_to_need_recipients_{population}", N.normalize_count(to_need["n"])
                )
            )
            facts.append(
                MappedFact(f"aid.merit_to_need_recipients_pct_{population}", _pct(to_need["pct"]))
            )
            continue
        no_need = _MERIT_NO_NEED_RE.search(item)
        if no_need:
            facts.append(
                MappedFact(
                    f"aid.merit_no_need_recipients_{population}", N.normalize_count(no_need["n"])
                )
            )
            facts.append(
                MappedFact(f"aid.merit_no_need_recipients_pct_{population}", _pct(no_need["pct"]))
            )
            facts.append(
                MappedFact(
                    f"aid.merit_no_need_avg_{population}",
                    N.normalize_money(f"${no_need['amount']}"),
                )
            )
    return facts


def dual_merit_pair(raw: str, *, recipients_key: str, avg_key: str) -> list[MappedFact]:
    """A single `dual_merit` sentence (lead figure + `$amount`) -> 2 facts."""
    absence = absence_display(raw)
    if absence is not None:
        return [MappedFact(recipients_key, None), MappedFact(avg_key, None)]
    try:
        lead, amount = N.normalize_dual_merit(raw)
    except NormalizeError:
        return [MappedFact(recipients_key, N.normalize_text(raw))]
    return [MappedFact(recipients_key, lead), MappedFact(avg_key, amount)]


# ---------------------------------------------------------------------------
# NestedTitleValue groups
# ---------------------------------------------------------------------------

# child label -> the fact_key stem it contributes (money-matters "Average
# Award" NestedTitleValue, appendix ii §3 — not a generic slug of the label).
_AWARD_CHILD_STEMS: Mapping[str, str] = {
    "need-based gift": "need_gift",
    "need-based self-help": "need_selfhelp",
}

_AWARD_SENTENCE_RE = re.compile(
    r"Received by\s+(?P<n>[\d,]+)\s*\(\s*(?P<pct>[\d.]+)%\s*\)\s*of\s+aid\s+recipients,"
    r"\s*average\s+amount\s+\$(?P<amount>[\d,]+)",
    re.IGNORECASE,
)


def nested_award(group: Sequence[WalkedNode], *, population: str) -> list[MappedFact]:
    """ "Average Award" NestedTitleValue (money-matters): parent is a plain
    money scalar; each child ("Need-Based Gift"/"Need-Based Self-Help")
    carries its own `Received by N (P%) ..., average amount $X` sentence."""
    parent, *children = group
    facts = scalar(_single(parent.raw), base_key=f"aid.avg_award_{population}", kind="money")
    for child in children:
        stem = _AWARD_CHILD_STEMS.get(child.label.strip().lower())
        if stem is None:
            continue
        facts.extend(_award_child_facts(_single(child.raw), stem=stem, population=population))
    return facts


def _award_child_facts(raw: str, *, stem: str, population: str) -> list[MappedFact]:
    keys = (
        f"aid.{stem}_recipients_{population}",
        f"aid.{stem}_recipients_pct_{population}",
        f"aid.{stem}_avg_{population}",
    )
    absence = absence_display(raw)
    if absence is not None:
        return [MappedFact(key, None) for key in keys]
    match = _AWARD_SENTENCE_RE.search(raw)
    if not match:
        return [MappedFact(keys[0], N.normalize_text(raw))]
    return [
        MappedFact(keys[0], N.normalize_count(match["n"])),
        MappedFact(keys[1], _pct(match["pct"])),
        MappedFact(keys[2], N.normalize_money(f"${match['amount']}")),
    ]


def nested_list_count(group: Sequence[WalkedNode], *, area: str) -> list[MappedFact]:
    """One "Non-Need Awards" group (money-matters): parent = a list of award
    areas, one child titled "Number of Awards" = a count."""
    parent, *children = group
    parent_items = to_str_list(parent.raw)
    facts = (
        list_value(parent_items, base_key=f"aid.non_need_{area}_areas")
        if parent_items is not None
        else []
    )
    for child in children:
        if child.label.strip().lower() != "number of awards":
            continue
        raw = _single(child.raw)
        absence = absence_display(raw)
        facts.append(
            MappedFact(
                f"aid.non_need_{area}_count",
                None if absence is not None else N.normalize_count(raw),
            )
        )
    return facts


def student_body_group(group: Sequence[WalkedNode]) -> list[MappedFact]:
    """`students` tab's "All Undergraduates" NestedTitleValue: parent = a plain
    count, children "Women"/"Men" = `"3,337 (50.1%)"` (count + pct, comma form)."""
    parent, *children = group
    facts = scalar(_single(parent.raw), base_key="students.undergraduate_total", kind="count")
    count_pct_re = re.compile(r"^(?P<n>[\d,]+)\s*\(\s*(?P<pct>[\d.]+)%\s*\)$")
    for child in children:
        dim = _DIMENSION_SUFFIX.get(_slug(child.label))
        if dim is None:
            continue
        gender = dim.lstrip("_")
        raw = _single(child.raw)
        absence = absence_display(raw)
        if absence is not None:
            facts.append(MappedFact(f"students.undergraduate_{gender}_count", None))
            facts.append(MappedFact(f"students.undergraduate_{gender}_pct", None))
            continue
        match = count_pct_re.match(raw.strip())
        if not match:
            facts.append(
                MappedFact(f"students.undergraduate_{gender}_count", N.normalize_text(raw))
            )
            continue
        facts.append(
            MappedFact(f"students.undergraduate_{gender}_count", N.normalize_count(match["n"]))
        )
        facts.append(MappedFact(f"students.undergraduate_{gender}_pct", _pct(match["pct"])))
    return facts
