"""The mapper: snapshot tree -> `FactRow`s (plan §4.4).

`map_snapshot` is the one public entry point. It takes whichever tabs were
fetched `ok` this pass (a school never has all six on a bad day — a missing
tab just means fewer input pages, never an error) plus an optional
`fallback_cycle_year` (the year to anchor bare month-day deadlines against
when the `admission` tab itself was not fetched this pass — plan §4.4: "if
the admission tab was not fetched ok this pass the anchor is taken from the
current stored `deadlines.regular` fact"; sourcing that value from the store
is `app/facts/crawl.py`'s job, not this module's).

Routing is driven entirely by `config/assets/facts_keys.yaml` — label
patterns keyed by `(tab, expandable_section, divider, node_type)` plus an
optional `match` regex on the node's own label (plan §4.4: "the divider is a
hard qualifier ... a named capture is never part of the fact_key"). A
leaf/group that matches no rule becomes an `unmapped:<source_path>`
`FactRow` with `value=None` (plan §4.4) rather than being silently dropped.

Two structural cases sit outside the per-leaf rule table because they need
data from *two* leaves at once and are handled once, up front:
`attendanceCost`/`tuitionFeesCost` header pairs, and the admission-tab
`deadlines.regular` header pair (which also anchors `cycle_year` for every
other bare month-day deadline this pass, plan §4.4).
"""

from __future__ import annotations

import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from adapters.collegedata.parse import ParsedPage, WalkedNode, walk_header, walk_page
from app.facts import mapper_handlers as H
from app.facts import mapper_table_handlers as HT
from config.settings import load_yaml_asset
from domain.envelope import JsonValue
from domain.facts import period as P
from domain.facts.models import FactRow, NormalizedValue, TabName
from domain.facts.normalize import (
    NormalizeError,
    absence_display,
    normalize_date,
    normalize_decimal,
    normalize_url,
)

__all__ = ["MapResult", "load_facts_keys", "map_snapshot"]

FACTS_KEYS_ASSET = "facts_keys"

# Tabs whose body is walked. `overview` is header-only (unit report #1): every
# overview-body label is a verbatim duplicate of one on a topic tab.
_BODY_TABS: frozenset[str] = frozenset(
    {"admission", "money-matters", "academics", "campus-life", "students"}
)

_PAIRED_HEADER_KEYS = frozenset({"attendanceCost", "tuitionFeesCost"})

_OUTCOME_SECTION_TITLES = frozenset({"Undergraduate Retention & Graduation", "After Graduation"})
_DEFAULT_SECTION_BY_TAB: Mapping[str, str] = {
    "admission": "getting-in",
    "money-matters": "money",
    "academics": "academics",
    "campus-life": "campus-life",
    "students": "campus-life",
}

_GROUPED_NODE_TYPES = frozenset({"NestedTitleValue", "LabeledTable", "IconTable"})


@dataclass(frozen=True, slots=True)
class MapResult:
    facts: tuple[FactRow, ...]
    unmapped_count: int


def load_facts_keys() -> list[dict[str, Any]]:
    """The parsed `rules:` list from `config/assets/facts_keys.yaml`."""
    asset = load_yaml_asset(FACTS_KEYS_ASSET)
    rules = asset.get("rules") if isinstance(asset, dict) else None
    if not isinstance(rules, list):
        raise ValueError(f"{FACTS_KEYS_ASSET}.yaml must declare a top-level 'rules' list")
    return rules


def _base_path(source_path: str, node_type: str) -> str:
    """The table/nested-group instance path — everything up to and including
    `<node_type>#<n>` (a row/child leaf's path always extends it by `/...`)."""
    marker = f"{node_type}#"
    idx = source_path.rfind(marker)
    if idx == -1:
        return source_path
    digits = source_path[idx + len(marker) :].split("/", 1)[0]
    return source_path[: idx + len(marker)] + digits


def _group_leaves(leaves: Sequence[WalkedNode]) -> list[WalkedNode | list[WalkedNode]]:
    """Standalone leaves pass through unchanged; leaves belonging to one
    NestedTitleValue/LabeledTable/IconTable instance are collected into a
    single group (first-seen order), so a table-level handler sees the whole
    table (or nested parent+children) at once. Each group's list object is
    inserted into `out` once, at the position of its first member, and then
    mutated in place as later rows/children for the same instance arrive —
    so `out` is already final and correctly ordered once the loop ends."""
    grouped: dict[str, list[WalkedNode]] = {}
    out: list[WalkedNode | list[WalkedNode]] = []
    for leaf in leaves:
        if leaf.node_type not in _GROUPED_NODE_TYPES:
            out.append(leaf)
            continue
        base = _base_path(leaf.source_path, leaf.node_type)
        if base not in grouped:
            grouped[base] = []
            out.append(grouped[base])
        grouped[base].append(leaf)
    return out


def _representative(item: WalkedNode | list[WalkedNode]) -> WalkedNode:
    return item if isinstance(item, WalkedNode) else item[0]


def _field_matches(rule: Mapping[str, Any], field_name: str, actual: str | None) -> bool:
    if field_name not in rule:
        return True  # absent = wildcard
    return bool(rule[field_name] == actual)


def _rule_matches(rule: Mapping[str, Any], node_type: str, tab: str, node: WalkedNode) -> bool:
    if rule.get("tab") != tab or rule.get("node_type") != node_type:
        return False
    if not _field_matches(rule, "expandable_section", node.section_title):
        return False
    if not _field_matches(rule, "divider", node.divider):
        return False
    pattern = rule.get("match")
    return pattern is None or re.fullmatch(pattern, node.label) is not None


def _display_label(node: WalkedNode) -> str:
    """`FactRow.label` requires non-empty text; a few real nodes print a
    blank title (the GPA `BarGraph`'s title is always `""`) — fall back to
    the divider/section context rather than storing an empty label."""
    return node.label or node.divider or node.section_title or node.node_type


@dataclass(slots=True)
class _Engine:
    rules: list[dict[str, Any]]
    cycle_year: int | None
    facts: list[FactRow] = field(default_factory=list)
    unmapped_count: int = 0

    def _emit(
        self, tab: TabName, node: WalkedNode, section: str, mapped: Sequence[H.MappedFact]
    ) -> None:
        section_period = (
            P.parse_financial_aid_title(node.section_title) if node.section_title else None
        )
        for fact in mapped:
            period, period_year = fact.reported_period, fact.reported_period_year
            if period is None and section_period is not None:
                period = section_period.reported_period
                period_year = section_period.reported_period_year
            self.facts.append(
                FactRow(
                    fact_key=fact.fact_key,
                    tab=tab,
                    section=section,
                    label=_display_label(node),
                    value=fact.value,
                    source_path=node.source_path,
                    reported_period=period,
                    reported_period_year=period_year,
                )
            )

    def _unmapped(self, tab: TabName, node: WalkedNode) -> None:
        section = (
            "outcomes"
            if node.section_title in _OUTCOME_SECTION_TITLES
            else _DEFAULT_SECTION_BY_TAB.get(tab, "campus-life")
        )
        self.unmapped_count += 1
        self.facts.append(
            FactRow(
                fact_key=f"unmapped:{node.source_path}",
                tab=tab,
                section=section,
                label=_display_label(node),
                value=None,
                source_path=node.source_path,
            )
        )

    def process(self, tab: TabName, items: Sequence[WalkedNode | list[WalkedNode]]) -> None:
        for item in items:
            rep = _representative(item)
            rule = next((r for r in self.rules if _rule_matches(r, rep.node_type, tab, rep)), None)
            if rule is None:
                self._unmapped(tab, rep)
                continue
            if rule.get("handler") == "drop":
                continue
            mapped = _dispatch(rule, item, self.cycle_year)
            self._emit(tab, rep, rule["section"], mapped)


_TABLE_GROUP_HANDLERS = frozenset(
    {
        "ordinal_table",
        "hs_requirements_table",
        "forms_required_table",
        "icon_matrix",
        "admission_rate_group",
        "enrolled_group",
        "student_body_group",
        "nested_award",
        "nested_list_count",
    }
)


def _dispatch(
    rule: Mapping[str, Any], item: WalkedNode | list[WalkedNode], cycle_year: int | None
) -> list[H.MappedFact]:
    handler_name = rule.get("handler", "scalar")
    base_key = rule.get("fact_key")
    # A `NestedTitleValue` with no real children still groups as a 1-member
    # list (`_group_leaves`); a rule targeting it with a leaf-shaped handler
    # (e.g. "Average Indebtedness of <year> Graduates", `scalar`/`kind:
    # money`) is dispatched against that single member, not the group.
    if isinstance(item, list) and handler_name in _TABLE_GROUP_HANDLERS:
        return _dispatch_group(handler_name, rule, item, cycle_year)
    return _dispatch_leaf(handler_name, rule, _representative(item), base_key, cycle_year)


def _dispatch_group(
    handler_name: str, rule: Mapping[str, Any], group: list[WalkedNode], cycle_year: int | None
) -> list[H.MappedFact]:
    if handler_name == "ordinal_table":
        return HT.ordinal_table(group, key_prefix=rule["key_prefix"])
    if handler_name == "hs_requirements_table":
        return HT.hs_requirements_table(group, cycle_year=cycle_year)
    if handler_name == "forms_required_table":
        return HT.forms_required_table(group)
    if handler_name == "icon_matrix":
        return HT.icon_matrix(group, columns=rule["columns"], base_key=rule["fact_key"])
    if handler_name == "admission_rate_group":
        return H.admission_rate_group(group)
    if handler_name == "enrolled_group":
        return H.enrolled_group(group)
    if handler_name == "student_body_group":
        return H.student_body_group(group)
    if handler_name == "nested_award":
        return H.nested_award(group, population=rule["population"])
    if handler_name == "nested_list_count":
        return H.nested_list_count(group, area=rule["area"])
    raise ValueError(f"unknown group handler {handler_name!r}")


def _dispatch_leaf(
    handler_name: str,
    rule: Mapping[str, Any],
    node: WalkedNode,
    base_key: str | None,
    cycle_year: int | None,
) -> list[H.MappedFact]:
    raw = node.raw
    if handler_name == "scalar":
        text = _single_or_join(raw)
        if text is None:
            return []
        return H.scalar(text, base_key=_require_base_key(base_key), kind=rule["kind"])
    if handler_name == "text_fallback_date":
        text = _single_or_join(raw)
        if text is None:
            return []
        return H.text_fallback_date(
            text, base_key=_require_base_key(base_key), cycle_year=cycle_year
        )
    if handler_name == "leading_percent":
        return H.leading_percent(_require_single(raw), base_key=_require_base_key(base_key))
    if handler_name == "compound_countries":
        return H.compound_countries(
            _require_single(raw), pct_key=rule["pct_key"], count_key=rule["count_key"]
        )
    if handler_name == "subscreen_list":
        return HT.subscreen_list(node, base_key=_require_base_key(base_key))
    if handler_name == "bar_graph_distribution":
        return H.bar_graph_distribution(
            node,
            base_key=_require_base_key(base_key),
            scale=rule.get("scale", base_key),
            unit=rule.get("unit", "percent"),
        )
    return _dispatch_leaf_structured(handler_name, rule, raw, base_key)


def _dispatch_leaf_structured(
    handler_name: str, rule: Mapping[str, Any], raw: JsonValue, base_key: str | None
) -> list[H.MappedFact]:
    """The other half of `_dispatch_leaf`'s handler table — dict-shaped
    (`TitleLink`/header-address) and list-shaped (`Sequence[str]`) leaves.
    Split out only to stay under the file's 50-line function budget."""
    if handler_name == "address_header":
        if not isinstance(raw, dict):
            return []
        return H.address_from_header_dict(raw, base_key=_require_base_key(base_key))
    if handler_name == "title_link_url":
        if not isinstance(raw, dict):
            return []
        return H.title_link_url(raw, base_key=_require_base_key(base_key))
    if handler_name == "title_link_text":
        if not isinstance(raw, dict):
            return []
        return H.title_link_text(raw, base_key=_require_base_key(base_key))
    if handler_name == "address_body":
        str_list = H.to_str_list(raw)
        if str_list is None:
            return []
        return H.address_from_body_array(str_list, base_key=_require_base_key(base_key))
    if handler_name == "labelled_pairs":
        str_list = H.to_str_list(raw)
        if str_list is None:
            return []
        return H.labelled_pairs(str_list, base_key=_require_base_key(base_key))
    if handler_name == "merit_based_gift":
        str_list = H.to_str_list(raw)
        if str_list is None:
            return []
        return H.merit_based_gift(str_list, population=rule["population"])
    if handler_name == "list_value":
        str_list = H.to_str_list(raw)
        if str_list is None:
            return []
        return H.list_value(str_list, base_key=_require_base_key(base_key))
    raise ValueError(f"unknown handler {handler_name!r}")


def _require_base_key(base_key: str | None) -> str:
    if base_key is None:
        raise ValueError("this handler requires the rule to declare fact_key")
    return base_key


def _single_or_join(raw: JsonValue) -> str | None:
    # Several header scalars are natively int/float in the source JSON
    # (undergradPopulation, malePercentage, ...), not strings — str() them
    # rather than dropping the leaf silently (a real, present value that
    # happens to already be numeric is not the same as no value at all).
    if isinstance(raw, str):
        return raw
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return str(raw)
    if isinstance(raw, list) and len(raw) == 1:
        return _single_or_join(raw[0])
    return None


def _require_single(raw: JsonValue) -> str:
    text = _single_or_join(raw)
    if text is None:
        raise ValueError(f"expected a single string value, got {raw!r}")
    return text


def _cycle_year(pages: Mapping[TabName, ParsedPage], fallback_cycle_year: int | None) -> int | None:
    admission = pages.get("admission")
    if admission is not None and admission.header.admissionDeadlineDate:
        match = re.match(r"^(\d{4})-\d{2}-\d{2}$", admission.header.admissionDeadlineDate)
        if match:
            return int(match[1])
    return fallback_cycle_year


def _admission_deadline_facts(admission: ParsedPage) -> Iterator[FactRow]:
    """`deadlines.regular` (+ `admissions.regular_deadline_is_rolling`) from the
    admission-tab header pair — the header wins over the body's pre-formatted
    duplicate row (dropped in `facts_keys.yaml`, because
    the header's ISO date is parseable, the body's spelled-out prose is
    not, and the header cleanly carries the Rolling case too)."""
    header = admission.header
    source_path = "admission/@profile/admissionDeadline"
    if header.admissionDeadlineDate:
        year_match = re.match(r"^(\d{4})-\d{2}-\d{2}$", header.admissionDeadlineDate)
        if not year_match:
            return
        value = normalize_date(header.admissionDeadlineDate)
        year = int(year_match[1])
        period = P.deadline_reported_period(year)
        yield FactRow(
            fact_key="deadlines.regular",
            tab="admission",
            section="applying",
            label="Regular Admission Deadline",
            value=value,
            source_path=source_path,
            reported_period=period,
            reported_period_year=year - 1,
        )
    elif header.admissionDeadline and header.admissionDeadline.strip().lower() == "rolling":
        rolling = NormalizedValue(kind="enum", display="Rolling", value_text="rolling")
        yield FactRow(
            fact_key="deadlines.regular",
            tab="admission",
            section="applying",
            label="Regular Admission Deadline",
            value=rolling,
            source_path=source_path,
        )
        yield FactRow(
            fact_key="admissions.regular_deadline_is_rolling",
            tab="admission",
            section="getting-in",
            label="Regular Admission Deadline",
            value=NormalizedValue(kind="bool", display="Rolling", value_bool=True),
            source_path=source_path,
        )


_GPA_LEADING_NUMBER_RE = re.compile(r"^(?P<gpa>[\d.]+)")


def _overview_body_extras(pages: Mapping[TabName, ParsedPage]) -> Iterator[FactRow]:
    """Two facts genuinely exist **only** on `overview`'s body (Entrance
    Difficulty, Average GPA) — confirmed live: every other overview-body
    label duplicates a topic tab's own row verbatim (unit report #1), but
    neither of these two do, and `admissions.entrance_difficulty` is the one
    `ENTRANCE_DIFFICULTY_NOTE` (`domain/facts/state.py`) needs a real source
    for. Extracted directly rather than by walking the whole body (which
    mapper.py deliberately never does for `overview` — the rest of that body
    would need ~30 explicit `drop` rules for no product value)."""
    overview = pages.get("overview")
    if overview is None:
        return
    for node in walk_page("overview", overview.body):
        if node.label == "Entrance Difficulty":
            raw = _single_or_join(node.raw)
            if raw is None:
                continue
            for fact in H.scalar(raw, base_key="admissions.entrance_difficulty", kind="enum"):
                yield FactRow(
                    fact_key=fact.fact_key,
                    tab="overview",
                    section="getting-in",
                    label=node.label,
                    value=fact.value,
                    source_path=node.source_path,
                )
        elif node.label == "Average GPA":
            raw = _single_or_join(node.raw)
            if raw is None:
                continue
            value = None
            if absence_display(raw) is None:
                match = _GPA_LEADING_NUMBER_RE.match(raw.strip())
                value = normalize_decimal(match["gpa"]) if match else None
            yield FactRow(
                fact_key="class_profile.average_gpa",
                tab="overview",
                section="getting-in",
                label=node.label,
                value=value,
                source_path=node.source_path,
            )


def _identity_website(pages: Mapping[TabName, ParsedPage]) -> FactRow | None:
    """Unlike every other value here, `website` never went through
    `_Engine.process`'s per-leaf rule dispatch (it's a top-level profile
    field, not a header/body leaf), so it never got that dispatch's
    `NormalizeError` -> `unmapped:` routing either -- a school whose raw
    website string didn't parse (e.g. a stray non-URL value) crashed this
    school's entire fact write for the pass instead of just dropping one
    fact (school-data-v3 fix review). Match the documented contract: a
    value that fails to normalize becomes `unmapped:<source_path>`, not a
    fatal error for the whole school."""
    overview = pages.get("overview")
    if overview is None:
        return None
    website = overview.raw_profile.get("website")
    if not isinstance(website, str) or not website:
        return None
    source_path = "overview/@profile/website"
    try:
        value = normalize_url(website)
    except NormalizeError:
        return FactRow(
            fact_key=f"unmapped:{source_path}",
            tab="overview",
            section="campus-life",
            label="website",
            value=None,
            source_path=source_path,
        )
    return FactRow(
        fact_key="identity.website",
        tab="overview",
        section="campus-life",
        label="website",
        value=value,
        source_path=source_path,
    )


def _paired_header_facts(
    tab: TabName, header_leaves: Sequence[WalkedNode], rules: Sequence[dict[str, Any]]
) -> tuple[list[FactRow], set[int]]:
    """Consume `attendanceCost`/`tuitionFeesCost`'s two leaves as one unit."""
    by_label: dict[str, list[tuple[int, WalkedNode]]] = {}
    for idx, leaf in enumerate(header_leaves):
        if leaf.label in _PAIRED_HEADER_KEYS:
            by_label.setdefault(leaf.label, []).append((idx, leaf))
    out: list[FactRow] = []
    consumed: set[int] = set()
    for label, pairs in by_label.items():
        pairs.sort(key=lambda pair: pair[1].source_path)
        consumed.update(idx for idx, _ in pairs)
        rule = next(
            (
                r
                for r in rules
                if r.get("tab") == tab
                and r.get("node_type") == "header"
                and r.get("match") == label
            ),
            None,
        )
        if rule is None or rule.get("handler") == "drop":
            continue
        str_values = H.to_str_list([leaf.raw for _, leaf in pairs])
        if str_values is None:
            continue
        base_path = pairs[0][1].source_path.rsplit("/", 1)[0]
        for fact in H.paired_header(str_values, base_key=rule["fact_key"]):
            out.append(
                FactRow(
                    fact_key=fact.fact_key,
                    tab=tab,
                    section=rule["section"],
                    label=label,
                    value=fact.value,
                    source_path=base_path,
                )
            )
    return out, consumed


def map_snapshot(
    pages: Mapping[TabName, ParsedPage], *, fallback_cycle_year: int | None = None
) -> MapResult:
    """Map one school's fetched-this-pass pages into `FactRow`s (module docstring)."""
    rules = load_facts_keys()
    cycle_year = _cycle_year(pages, fallback_cycle_year)
    engine = _Engine(rules=rules, cycle_year=cycle_year)

    for tab, page in pages.items():
        header_leaves = list(walk_header(tab, page.header))
        paired_facts, consumed = _paired_header_facts(tab, header_leaves, rules)
        engine.facts.extend(paired_facts)
        standalone_header = [leaf for i, leaf in enumerate(header_leaves) if i not in consumed]
        engine.process(tab, _group_leaves(standalone_header))

        if tab in _BODY_TABS:
            body_leaves = list(walk_page(tab, page.body))
            if tab == "academics" and page.header.headerCardContent:
                body_leaves = list(walk_page(tab, page.header.headerCardContent)) + body_leaves
            engine.process(tab, _group_leaves(body_leaves))

    website_fact = _identity_website(pages)
    if website_fact is not None:
        engine.facts.append(website_fact)
    engine.facts.extend(_overview_body_extras(pages))

    admission = pages.get("admission")
    if admission is not None:
        engine.facts.extend(_admission_deadline_facts(admission))

    return MapResult(facts=tuple(engine.facts), unmapped_count=engine.unmapped_count)
