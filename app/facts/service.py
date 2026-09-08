"""Facts-page presenter (plan §5.1/§5.2): layout + the deadlines block +
freshness/caveat composition on top of `counselle_db.service.get_facts`'s
raw read. Every student-facing absence word and section sentence is
composed here, once, server-side -- the frontend authors none of it.

Band composition (SAT/ACT `_p25`/`_p75` pairs -> one `band` fact) and the
`_BAND_SCALES` min/max table live here rather than in
`domain/facts/normalize.py` (where plan §5.2 places them): this unit does
not touch `domain/facts/` (Phase 1's, and the crawl is running against it).
See this unit's final report.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal, cast

from app.facts.response_models import (
    CaveatWire,
    DeadlineRow,
    DeadlinesBlock,
    Fact,
    FactGroup,
    FactSection,
    SchoolFactsResponse,
    SchoolIdentity,
)
from config.settings import Settings
from counselle_db.catalog import Catalog, SectionFact, SectionGroup
from counselle_db.catalog import FactsSection as CatalogSection
from counselle_db.models import FactValueRow
from counselle_db.service import get_facts as _get_facts
from domain.facts import state as state_module
from domain.facts.models import NOT_FETCHED_STATUSES, FactState, NormalizedValue, PageStatus
from domain.facts.state import fact_state, is_stale, section_state

__all__ = ["absence_display", "get_school_facts"]

_DEADLINES_SECTION_ID = "applying"
_DEADLINES_GROUP_ID = "deadlines"
_ROLLING_KEY = "admissions.regular_deadline_is_rolling"
_OFFERED_KEY_FOR_DEADLINE = {
    "deadlines.early_decision": "admissions.early_decision_offered",
    "deadlines.early_action": "admissions.early_action_offered",
}

# Known test-score band families: fact_key stem -> (scale_min, scale_max).
_BAND_SCALES: dict[str, tuple[int, int]] = {
    "class_profile.sat_math": (200, 800),
    "class_profile.sat_ebrw": (200, 800),
    "class_profile.act_composite": (1, 36),
}

_NOT_PUBLISHED_LINE = "We don't hold this school's {section} information."
_NOT_FETCHED_LINE = "We couldn't read this page on the last check."
_NEVER_FETCHED_LINE = "We haven't checked this page yet."
_RECHECK_LINE = "We couldn't re-check this page on the last run — these values are from {month}."
_PARTIAL_LINES = {
    "not_found": "We don't hold part of this section for this school.",
    "read_failure": "Part of this section couldn't be re-checked on the last run.",
    "both": (
        "We don't hold part of this section for this school, and part "
        "couldn't be re-checked on the last run."
    ),
}
_PERIOD_FOOT = "Where no year is shown, we don't know which year the figure covers."
_DEADLINES_FOOT_WITH_CYCLE = (
    "Dates last confirmed {month} for the {cycle} cycle. "
    "Confirm on the school's site before you apply."
)
_DEADLINES_FOOT_NO_CYCLE = (
    "Dates last confirmed {month}. Confirm on the school's site before you apply."
)
_DEADLINES_FOOT_NO_DATE = "Confirm on the school's site before you apply."
_STALE_FRESHNESS_LINE = "Last checked {month} — this may be out of date"
_FRESH_FRESHNESS_LINE = "Checked {month}"
# Kept local to this presenter rather than routed through `app.caveats`
# (whose `caveat_catalog()` expected-kind set is the CDS-era agent caveat
# system, rewritten in Phase 3 to the eight v3 kinds -- plan §6a). See final
# report.
_STALE_CAVEAT_TEXT = (
    "This page's information may be out of date. "
    "Confirm anything time-sensitive on the school's site."
)


def _month_year(dt: datetime) -> str:
    return dt.strftime("%B %Y")


def _resolve_state(
    row: FactValueRow | None, page_status: PageStatus, has_collegedata: bool
) -> FactState:
    """`current_school_facts` never persists an explicit-absence row (the
    mapper drops every `FactRow` whose `value is None` before it reaches the
    store) -- `has_row` alone already determines "value" without needing the
    real `NormalizedValue` back. The cast is a type shim over that
    invariant, not a bypass of `fact_state`'s own `value is not None` check.
    """
    sentinel = cast(NormalizedValue, object()) if row is not None else None
    return fact_state(row is not None, sentinel, page_status, has_collegedata)


_NOT_REPORTED_DISPLAY = "Not reported"


def absence_display(state: FactState, page_status: PageStatus) -> str:
    if state == "not_reported":
        return _NOT_REPORTED_DISPLAY
    if state == "not_published":
        return "Not on file"
    if state == "not_fetched":
        return "Not checked yet" if page_status == "never_fetched" else "Not checked"
    if state == "not_collected":
        return "Not collected"
    return ""


def _enrich_distribution(payload: Any) -> Any:
    """Attach the resolved absence word to a `distribution` fact's
    not-reported and omitted buckets, server-side (plan §5.1/§7) --
    `FactDistributionChart.tsx` renders `absence_display`/`display`
    verbatim and authors no absence word of its own (Finding 5, Phase 2
    review)."""
    if not isinstance(payload, dict):
        return payload
    buckets = payload.get("buckets")
    omitted = payload.get("omitted_buckets")
    enriched_buckets = (
        [
            {**bucket, "absence_display": _NOT_REPORTED_DISPLAY}
            if isinstance(bucket, dict) and bucket.get("absence") == "not_reported"
            else bucket
            for bucket in buckets
        ]
        if isinstance(buckets, list)
        else buckets
    )
    enriched_omitted = (
        [{"label": label, "display": _NOT_REPORTED_DISPLAY} for label in omitted]
        if isinstance(omitted, list)
        else omitted
    )
    return {**payload, "buckets": enriched_buckets, "omitted_buckets": enriched_omitted}


def _kind_and_value(row: FactValueRow) -> tuple[str, Any]:
    value_type = row.value_type
    payload = row.value.get("value") if isinstance(row.value, dict) else None
    if value_type == "url":
        return "link", row.value_text
    if value_type == "distribution":
        return value_type, _enrich_distribution(payload)
    if value_type in ("list", "table", "matrix", "ordinal"):
        return value_type, payload
    if value_type == "range":
        lo = payload.get("lo") if isinstance(payload, dict) else None
        hi = payload.get("hi") if isinstance(payload, dict) else None
        return "band", {"p25": lo, "p75": hi, "min": None, "max": None, "submitted_percent": None}
    if row.value_date is not None:
        return "scalar", row.value_date.isoformat()
    for candidate in (row.value_num, row.value_text, row.value_bool):
        if candidate is not None:
            return "scalar", candidate
    return "scalar", None


def _build_fact(
    spec: SectionFact, row: FactValueRow | None, page_status: PageStatus, has_collegedata: bool
) -> Fact:
    state = _resolve_state(row, page_status, has_collegedata)
    if row is not None:
        kind, value = _kind_and_value(row)
        return Fact(
            key=spec.key,
            label=spec.label,
            tab=spec.tab,
            state=state,
            kind=cast(Any, kind),
            display=row.display,
            unit=row.unit,
            value=value,
            observed_at=row.observed_at.isoformat(),
            reported_period=row.reported_period,
        )
    return Fact(
        key=spec.key,
        label=spec.label,
        tab=spec.tab,
        state=state,
        kind="scalar",
        display=absence_display(state, page_status),
        unit=None,
        value=None,
        observed_at=None,
        reported_period=None,
    )


def _try_band(
    spec: SectionFact,
    group_facts: tuple[SectionFact, ...],
    facts_by_key: dict[str, FactValueRow],
    tabs: dict[str, str],
    has_collegedata: bool,
) -> tuple[Fact, set[str]] | None:
    if not spec.key.endswith("_p25"):
        return None
    prefix = spec.key[: -len("_p25")]
    if prefix not in _BAND_SCALES:
        return None
    p75_key = f"{prefix}_p75"
    if not any(f.key == p75_key for f in group_facts):
        return None
    p25_row = facts_by_key.get(spec.key)
    p75_row = facts_by_key.get(p75_key)
    scale_min, scale_max = _BAND_SCALES[prefix]
    page_status = cast(PageStatus, tabs.get(spec.tab, "never_fetched"))
    label = spec.label.replace(" 25th percentile", "").strip()
    if p25_row is not None and p75_row is not None:
        p25, p75 = p25_row.value_num, p75_row.value_num
        display = f"{p25:.0f}-{p75:.0f}" if p25 is not None and p75 is not None else p25_row.display
        observed = min(p25_row.observed_at, p75_row.observed_at)
        fact = Fact(
            key=prefix,
            label=label,
            tab=spec.tab,
            state="value",
            kind="band",
            display=display,
            unit=None,
            value={
                "p25": p25,
                "p75": p75,
                "min": scale_min,
                "max": scale_max,
                "submitted_percent": None,
            },
            observed_at=observed.isoformat(),
            reported_period=p25_row.reported_period,
        )
    else:
        state = _resolve_state(p25_row or p75_row, page_status, has_collegedata)
        fact = Fact(
            key=prefix,
            label=label,
            tab=spec.tab,
            state=state,
            kind="band",
            display=absence_display(state, page_status),
            unit=None,
            value=None,
            observed_at=None,
            reported_period=None,
        )
    return fact, {spec.key, p75_key}


def _group_facts(
    group: SectionGroup,
    facts_by_key: dict[str, FactValueRow],
    tabs: dict[str, str],
    has_collegedata: bool,
) -> tuple[Fact, ...]:
    out: list[Fact] = []
    consumed: set[str] = set()
    for spec in group.facts:
        if spec.key in consumed:
            continue
        band = _try_band(spec, group.facts, facts_by_key, tabs, has_collegedata)
        if band is not None:
            fact, keys_used = band
            out.append(fact)
            consumed.update(keys_used)
            continue
        row = facts_by_key.get(spec.key)
        page_status = cast(PageStatus, tabs.get(spec.tab, "never_fetched"))
        out.append(_build_fact(spec, row, page_status, has_collegedata))
    return tuple(out)


def _partial_cause(tab_statuses: Mapping[str, str]) -> str:
    non_ok = [status for status in tab_statuses.values() if status != "ok"]
    has_not_found = any(status == "not_found" for status in non_ok)
    has_read_failure = any(status in NOT_FETCHED_STATUSES for status in non_ok)
    if has_not_found and has_read_failure:
        return _PARTIAL_LINES["both"]
    return _PARTIAL_LINES["not_found"] if has_not_found else _PARTIAL_LINES["read_failure"]


def _section_line(
    fetch_state: str,
    never_checked: bool,
    section_title: str,
    tab_statuses: Mapping[str, str],
    surviving_oldest: datetime | None,
) -> str | None:
    if fetch_state == "ok":
        return None
    if fetch_state == "not_published":
        return _NOT_PUBLISHED_LINE.format(section=section_title)
    if fetch_state == "partial":
        return _partial_cause(tab_statuses)
    if surviving_oldest is not None:
        return _RECHECK_LINE.format(month=_month_year(surviving_oldest))
    return _NEVER_FETCHED_LINE if never_checked else _NOT_FETCHED_LINE


def _build_section(
    section: CatalogSection,
    facts_by_key: dict[str, FactValueRow],
    tabs: dict[str, str],
    has_collegedata: bool,
) -> FactSection | None:
    group_specs = (
        [g for g in section.groups if g.id != _DEADLINES_GROUP_ID]
        if section.id == _DEADLINES_SECTION_ID
        else list(section.groups)
    )
    tab_statuses = {tab: tabs.get(tab, "never_fetched") for tab in section.tabs}
    fetch_state, never_checked = section_state(cast(Any, tab_statuses))
    groups: list[FactGroup] = []
    all_facts: list[Fact] = []
    for group in group_specs:
        facts = _group_facts(group, facts_by_key, tabs, has_collegedata)
        if not facts:
            continue
        all_facts.extend(facts)
        foot = group.foot
        if foot is None and group.foot_ref:
            candidate = getattr(state_module, group.foot_ref, None)
            if isinstance(candidate, str) and any(f.state == "value" for f in facts):
                foot = candidate
        groups.append(FactGroup(id=group.id, label=group.label, foot=foot, chart=None, facts=facts))
    if not groups:
        return None
    surviving_at = [
        datetime.fromisoformat(f.observed_at)
        for f in all_facts
        if f.state == "value" and f.observed_at
    ]
    oldest = min(surviving_at) if fetch_state == "not_fetched" and surviving_at else None
    line = _section_line(fetch_state, never_checked, section.title, tab_statuses, oldest)
    period_foot = (
        _PERIOD_FOOT
        if any(f.state == "value" and f.reported_period is None for f in all_facts)
        else None
    )
    return FactSection(
        id=section.id,
        title=section.title,
        fetch_state=cast(Any, fetch_state),
        never_checked=never_checked,
        line=line,
        foot=period_foot,
        groups=tuple(groups),
    )


def _deadline_round_label(label: str) -> str:
    suffix = " deadline"
    return label[: -len(suffix)] if label.endswith(suffix) else label


def _build_deadlines(
    facts_by_key: dict[str, FactValueRow],
    tabs: dict[str, str],
    has_collegedata: bool,
    deadlines_group: SectionGroup | None,
) -> DeadlinesBlock:
    if deadlines_group is None:
        return DeadlinesBlock(rows=(), foot=_DEADLINES_FOOT_NO_DATE)
    rows: list[DeadlineRow] = []
    observed: list[datetime] = []
    cycle: str | None = None
    for spec in deadlines_group.facts:
        if spec.key == _ROLLING_KEY:
            continue
        page_status = cast(PageStatus, tabs.get(spec.tab, "never_fetched"))
        offered_key = _OFFERED_KEY_FOR_DEADLINE.get(spec.key)
        offered_row = facts_by_key.get(offered_key) if offered_key else None
        if offered_row is not None and offered_row.value_bool is False:
            rows.append(
                DeadlineRow(
                    round=_deadline_round_label(spec.label),
                    date=None,
                    display="Not offered",
                    reported_period=None,
                    state="value",
                    observed_at=offered_row.observed_at.isoformat(),
                )
            )
            continue
        row = facts_by_key.get(spec.key)
        state = _resolve_state(row, page_status, has_collegedata)
        if row is not None:
            display = (
                "Rolling" if (row.value_text or "").strip().lower() == "rolling" else row.display
            )
            rows.append(
                DeadlineRow(
                    round=_deadline_round_label(spec.label),
                    date=row.value_date.isoformat() if row.value_date else None,
                    display=display,
                    reported_period=row.reported_period,
                    state=state,
                    observed_at=row.observed_at.isoformat(),
                )
            )
            observed.append(row.observed_at)
            cycle = cycle or row.reported_period
        else:
            rows.append(
                DeadlineRow(
                    round=_deadline_round_label(spec.label),
                    date=None,
                    display=absence_display(state, page_status),
                    reported_period=None,
                    state=state,
                    observed_at=None,
                )
            )
    if observed:
        oldest = min(observed)
        foot = (
            _DEADLINES_FOOT_WITH_CYCLE.format(month=_month_year(oldest), cycle=cycle)
            if cycle
            else _DEADLINES_FOOT_NO_CYCLE.format(month=_month_year(oldest))
        )
    else:
        foot = _DEADLINES_FOOT_NO_DATE
    return DeadlinesBlock(rows=tuple(rows), foot=foot)


_CONTROL_MAP: dict[str, Literal["public", "private", "private_for_profit"]] = {
    "Public": "public",
    "Private not-for-profit": "private",
    "Private for-profit": "private_for_profit",
}


def _control(
    basic_profile: Mapping[str, Any],
) -> Literal["public", "private", "private_for_profit"] | None:
    classification = basic_profile.get("classification") or {}
    control = classification.get("control")
    if control is None:
        return None
    # Exhaustive mapping over IPEDS's `classification.control` vocabulary
    # (verified live: exactly "Public" / "Private not-for-profit" /
    # "Private for-profit"). Anything unrecognised falls through to an
    # honest unknown rather than a guessed control -- never substring-match
    # `sector` prose, which contains "for-profit" inside "not-for-profit".
    return _CONTROL_MAP.get(control)


def _undergraduates(facts_by_key: dict[str, FactValueRow]) -> int | None:
    row = facts_by_key.get("students.undergraduate_total")
    return int(row.value_num) if row is not None and row.value_num is not None else None


def _freshness_line(facts_updated_at: datetime | None, stale: bool) -> str | None:
    if facts_updated_at is None:
        return None
    template = _STALE_FRESHNESS_LINE if stale else _FRESH_FRESHNESS_LINE
    return template.format(month=_month_year(facts_updated_at))


async def get_school_facts(
    catalog: Catalog, unitid: int, settings: Settings
) -> SchoolFactsResponse:
    """The facts-page presenter: `counselle_db.service.get_facts`'s raw read
    plus layout (from `Catalog.snapshot.sections`), the deadlines block, and
    freshness/caveat composition. Raises `counselle_db.models.ServiceError`
    for an unknown unitid (the route maps that to 404); a school with
    `has_collegedata=False` still returns 200 with a fully-formed body.
    """
    result = await _get_facts(catalog, unitid)
    facts_by_key = {row.fact_key: row for row in result.rows}
    record = catalog.snapshot.schools[unitid]
    sections_spec: Mapping[str, CatalogSection] = catalog.snapshot.sections
    deadlines_group = None
    applying = sections_spec.get(_DEADLINES_SECTION_ID)
    if applying is not None:
        deadlines_group = next((g for g in applying.groups if g.id == _DEADLINES_GROUP_ID), None)
    deadlines = _build_deadlines(
        facts_by_key, result.status.tabs, result.status.has_collegedata, deadlines_group
    )
    sections = tuple(
        section
        for spec in sections_spec.values()
        if (
            section := _build_section(
                spec, facts_by_key, result.status.tabs, result.status.has_collegedata
            )
        )
        is not None
    )
    stale = is_stale(result.status.facts_updated_at, settings.facts_stale_days)
    domain = record.basics.official_domain
    identity = SchoolIdentity(
        unitid=record.basics.unitid,
        name=record.basics.name,
        city=record.basics.city,
        state=record.basics.state,
        control=_control(record.basic_profile),
        undergraduates=_undergraduates(facts_by_key),
        website_url=f"https://{domain}" if domain else None,
        domain=domain,
    )
    caveats = (
        (CaveatWire(id="stale_facts", text=_STALE_CAVEAT_TEXT, severity="ordinary"),)
        if stale
        else ()
    )
    return SchoolFactsResponse(
        identity=identity,
        has_collegedata=result.status.has_collegedata,
        observed_at=result.status.facts_updated_at.isoformat()
        if result.status.facts_updated_at
        else None,
        is_stale=stale,
        freshness_line=_freshness_line(result.status.facts_updated_at, stale),
        deadlines=deadlines,
        sections=sections,
        caveats=caveats,
    )
