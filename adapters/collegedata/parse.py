"""Typed parsing of collegedata.com's `pageProps.profile` JSON (plan §2/§4.4,
appendix E-i/E-ii §H).

Scope, deliberately narrow: this module turns the raw JSON `fetch.py` hands
back into a **typed, structural** representation — the nine closed
`bodyContent` node shapes (appendix E-i) plus the `pageProps.profile` header
scalars (appendix E-ii §H) — and a **typed walk** that flattens that tree
into `(source_path, label, raw)` leaves. It does *not* decide `fact_key`s,
match labels against `config/assets/facts_keys.yaml`, or call
`domain.facts.normalize` — that pattern-matching and normalization is
`app/facts/mapper.py`'s job (Unit D), which consumes this module's typed
tree and walk as its raw material. Concretely:

- A `LabeledTable`/`IconTable` row is walked as ONE leaf carrying the whole
  row's raw `values` plus the table's `valueTitles` (column headers) — this
  module cannot know whether a given table's columns are parallel facts
  (Required/Recommended units) or level codes for an ordinal pick (the
  importance-scale tables); only the mapper's `facts_keys.yaml` entry knows.
- A `TitleValue`'s `value` array is walked verbatim (a `list[str]`, even for
  a single-element array) — splitting a sentence-shaped value into multiple
  facts (e g. "5% of 50,264 applicants were admitted" → 3 facts) is
  `domain.facts.normalize`/the mapper's job, not this module's.
- Header scalars are walked as their raw JSON type (str/int/float/list/dict),
  never coerced into a domain value shape (money/percent/date/…) — that
  coercion is `domain.facts.normalize`'s job.

No HTML parsing (D11/plan §2) — everything here is pydantic over already-
decoded JSON.

Node shapes and the header field list were verified 2026-09-07 against six
live pages (Yale's overview/admission/money-matters/academics/campus-life/
students tabs) — see the Unit C progress notes for the raw captures. Every
node's `data` key set is closed (`extra="forbid"`); the header model uses
`extra="ignore"` so an as-yet-unseen header key on some other school's page
degrades to "not parsed" rather than crashing the whole crawl pass — Unit
D's mapper only ever sees keys this module declares, so a silently-ignored
new key is invisible to the mapper either way, never a silent product bug.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator, Mapping, Sequence
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from domain.envelope import JsonValue, reject_non_finite_json
from domain.facts.models import TabName

__all__ = [
    "AddressHeader",
    "BarGraphData",
    "BarGraphNode",
    "BodyNode",
    "CategoryDividerData",
    "CategoryDividerNode",
    "ExpandableSectionData",
    "ExpandableSectionNode",
    "IconTableNode",
    "LabeledTableData",
    "LabeledTableNode",
    "LabeledTableRow",
    "NestedTitleValueData",
    "NestedTitleValueNode",
    "ParseError",
    "ParsedPage",
    "ProfileHeader",
    "SubscreenNavigatorData",
    "SubscreenNavigatorNode",
    "TitleLinkData",
    "TitleLinkNode",
    "TitleValueData",
    "TitleValueNode",
    "WalkedNode",
    "content_hash",
    "extract_profile",
    "parse_page",
    "walk_header",
    "walk_page",
]


class ParseError(ValueError):
    """The raw JSON does not have the shape this module knows how to parse."""


# ---------------------------------------------------------------------------
# The nine bodyContent node types (appendix E-i). Every `data` key set is
# closed and verified across the six captured tabs.
# ---------------------------------------------------------------------------


class TitleValueData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    title: str
    # Always a list in practice (even a single scalar value is wrapped) —
    # measured lengths 1-14 (plan §4.4); never split here (module docstring).
    value: tuple[str, ...]


class TitleValueNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["TitleValue"]
    data: TitleValueData


class CategoryDividerData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    value: str


class CategoryDividerNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["CategoryDivider"]
    data: CategoryDividerData


class TitleLinkData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    title: str
    text: str
    link: str


class TitleLinkNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["TitleLink"]
    data: TitleLinkData


class NestedTitleValueData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    topTitleValue: TitleValueData
    children: tuple[TitleValueData, ...]


class NestedTitleValueNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["NestedTitleValue"]
    data: NestedTitleValueData


class LabeledTableRow(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    label: str
    # IconTable cells may be null (E-i: a null cell is `false`, "not
    # offered"); LabeledTable cells are always strings but a shared model
    # keeps the parser simple (mirrors the two node types' identical JSON
    # shape, per appendix E-i's "IconTable ... same" note).
    values: tuple[str | None, ...]


class LabeledTableData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    tableTitle: str | None = None
    keyTitle: str
    valueTitles: tuple[str, ...]
    data: tuple[LabeledTableRow, ...]


class LabeledTableNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["LabeledTable"]
    data: LabeledTableData


class IconTableNode(BaseModel):
    """Structurally identical to `LabeledTable` (appendix E-i) — a distinct
    pydantic class only so the discriminated union keeps `type` accurate."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["IconTable"]
    data: LabeledTableData


class BarGraphBucket(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    label: str
    # -1 = "not reported" for this bucket (plan §4.4/E-i); never invented as
    # 0. Some distributions are percentages (fractional, e.g. ethnicity),
    # not counts, so this is a float — verified live 2026-09-07 (Yale
    # students' ethnicity BarGraph carries values like 26.3).
    value: float


class BarGraphData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    title: str
    data: tuple[BarGraphBucket, ...]


class BarGraphNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["BarGraph"]
    data: BarGraphData


class SubscreenNavigatorData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    title: str
    buttonText: str
    data: tuple[str, ...]


class SubscreenNavigatorNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["SubscreenNavigator"]
    data: SubscreenNavigatorData


class ExpandableSectionData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    title: str
    iconType: str | None = None
    link: str | None = None
    children: tuple[BodyNode, ...]


class ExpandableSectionNode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    type: Literal["ExpandableSection"]
    data: ExpandableSectionData


BodyNode = Annotated[
    ExpandableSectionNode
    | CategoryDividerNode
    | TitleValueNode
    | TitleLinkNode
    | NestedTitleValueNode
    | LabeledTableNode
    | IconTableNode
    | BarGraphNode
    | SubscreenNavigatorNode,
    Field(discriminator="type"),
]

ExpandableSectionData.model_rebuild()

_BODY_NODES_ADAPTER: TypeAdapter[tuple[BodyNode, ...]] = TypeAdapter(tuple[BodyNode, ...])


# ---------------------------------------------------------------------------
# `pageProps.profile` header scalars (appendix E-ii §H). Field list verified
# live 2026-09-07 against Yale's six tabs (union of every non-`bodyContent`
# key observed); `extra="ignore"` for forward safety (module docstring).
# ---------------------------------------------------------------------------


class AddressHeader(BaseModel):
    """The header's `address`/`admission.address` shape — distinct from the
    body's four-element address array (appendix E-i's TitleValue address
    row); both normalize to `identity.*` addresses, but that reconciliation
    is the mapper's job (module docstring)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    street1: str | None = None
    street2: str | None = None
    city: str | None = None
    state: str | None = None
    zipCode: str | None = None


class ProfileHeader(BaseModel):
    """The `pageProps.profile` scalars (appendix E-ii §H), minus `id`/`slug`/
    `name`/`website`/`bodyContent` (structural, modeled separately by
    `ParsedPage`) and `chance` (ignored everywhere, E-N1 — dropped before
    hashing by `content_hash`, never parsed here at all).

    Every field stays at its raw JSON type — no money/percent/date coercion
    (module docstring); some (`phone`, `city`, `freshmanHousingGuarantee`)
    are documented duplicates or always-null at the header level and are
    modeled anyway for lineage fidelity, but `facts_keys.yaml` never maps
    them (appendix E-ii §H's "drop"/"use the body row" notes).
    """

    model_config = ConfigDict(frozen=True, extra="ignore")

    description: str | None = None
    alternativeName: str | None = None
    universityType: str | None = None
    populationType: str | None = None
    undergradPopulation: int | None = None
    gradPopulation: int | None = None
    malePercentage: float | None = None
    femalePercentage: float | None = None
    address: AddressHeader | None = None
    admissionsPhone: str | None = None
    admissionsFax: str | None = None
    admissionsEmail: str | None = None
    phone: str | None = None  # duplicate of admissionsPhone — drop (E-ii §H)
    admissionDeadline: str | None = None
    admissionDeadlineDate: str | None = None
    fullTimeFaculty: str | None = None  # comma-formatted, e.g. "1,545"
    partTimeFaculty: str | None = None
    undergraduateMajors: tuple[str, ...] = ()  # empty on every capture — do not use
    attendanceCost: tuple[str, ...] | None = None  # [in_state, out_of_state]
    tuitionFeesCost: tuple[str, ...] | None = None  # [in_state, out_of_state]
    roomBoardCost: str | None = None
    suppliesCost: str | None = None
    otherExpensesCost: str | None = None
    paymentPlans: tuple[str, ...] = ()
    headerCardContent: tuple[BodyNode, ...] = ()  # academics only; walked as a body array
    campusMapUrl: str | None = None
    city: str | None = None  # duplicate of address.city — drop
    cityPopulation: str | None = None  # comma-formatted, e.g. "130,660"
    nearestMetro: str | None = None
    avgJanTemp: float | None = None
    avgSeptTemp: float | None = None
    rain: float | None = None
    freshmanHousingGuarantee: str | None = None  # null at header level; body row is populated


class ParsedPage(BaseModel):
    """One tab's fully-typed page. `raw_profile` is the untouched
    `pageProps.profile` dict (what `page_snapshots.body`/`content_hash`
    operate on, per the seed's `body jsonb ... -- = pageProps.profile minus
    chance`) — kept alongside the typed views rather than reconstructed from
    them, so lineage never depends on this module's parsing being perfectly
    lossless.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    tab: TabName
    header: ProfileHeader
    body: tuple[BodyNode, ...]
    raw_profile: Mapping[str, JsonValue]


# ---------------------------------------------------------------------------
# Extraction, hashing, parsing
# ---------------------------------------------------------------------------


def extract_profile(top_level: Mapping[str, JsonValue]) -> Mapping[str, JsonValue]:
    """Dig `pageProps.profile` out of the top-level `/_next/data/...json`
    response body. Raises `ParseError` if the expected shape is absent —
    the caller (`fetch.py`) turns that into a `parse_error` page status
    rather than crashing the pass.
    """
    page_props = top_level.get("pageProps")
    if not isinstance(page_props, dict):
        raise ParseError("top-level JSON has no 'pageProps' object")
    profile = page_props.get("profile")
    if not isinstance(profile, dict):
        raise ParseError("'pageProps' has no 'profile' object")
    return profile


def content_hash(profile: Mapping[str, JsonValue]) -> bytes:
    """sha256 of the canonical JSON of `profile` with `chance` dropped first
    (plan §2's change-detection rule; DDL comment on `page_snapshots.body`).

    `chance` is `null` logged-out and session-derived if ever populated, so
    it is excluded before hashing (and before the value that becomes
    `page_snapshots.body`) — never a diff signal.
    """
    reject_non_finite_json(dict(profile))
    body = {key: value for key, value in profile.items() if key != "chance"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def snapshot_body(profile: Mapping[str, JsonValue]) -> Mapping[str, JsonValue]:
    """`profile` minus `chance` — exactly what `content_hash` hashes and
    what `page_snapshots.body` stores (the DDL comment, verbatim)."""
    return {key: value for key, value in profile.items() if key != "chance"}


def parse_page(tab: TabName, top_level: Mapping[str, JsonValue]) -> ParsedPage:
    """Parse one fetched tab's top-level JSON into a `ParsedPage`.

    Raises `ParseError` (never a bare pydantic `ValidationError`... actually
    a `ValidationError` from an unrecognized body-node shape is also a
    `ParseError`'s domain — both mean "this page didn't have the shape we
    know how to parse", which the caller routes to `parse_error`.
    """
    profile = extract_profile(top_level)
    try:
        header = ProfileHeader.model_validate(profile)
        body_raw = profile.get("bodyContent", [])
        if not isinstance(body_raw, list):
            raise ParseError("'profile.bodyContent' is not a list")
        body = _BODY_NODES_ADAPTER.validate_python(body_raw)
    except ParseError:
        raise
    except Exception as exc:  # pydantic ValidationError and friends
        raise ParseError(f"profile did not match the known shape: {exc}") from exc
    return ParsedPage(tab=tab, header=header, body=body, raw_profile=profile)


# ---------------------------------------------------------------------------
# The typed walk: (source_path, label, raw) leaves (module docstring).
# ---------------------------------------------------------------------------


class WalkedNode(BaseModel):
    """One flattened leaf from `walk_page`/`walk_header`. `raw` preserves
    the JSON shape as printed — a `list[str]` stays a list, a table row
    keeps its `values`/`columns` pairing — so the mapper (Unit D) has every
    bit of structure it needs to decide the `fact_key`, split a sentence
    value into several facts, or reject the label as unmapped.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    source_path: str = Field(min_length=1)
    section_title: str | None = None
    divider: str | None = None
    node_type: str = Field(min_length=1)
    label: str
    raw: JsonValue


def _table_row_raw(row: LabeledTableRow, columns: Sequence[str]) -> JsonValue:
    return {"values": list(row.values), "columns": list(columns)}


class _Walker:
    """One (tab, section) walk's mutable context — the running divider and
    the per-(divider, node type) ordinal counters (plan §4.4's
    `ordinal_within_divider`, always recorded, never assumed usable by this
    module — see the module docstring). One small `_walk_<type>` method per
    node type keeps each leaf-shape decision short and separately readable.
    """

    def __init__(self, tab: TabName, section_title: str | None) -> None:
        self._tab = tab
        self._section_title = section_title
        self._divider: str | None = None
        self._ordinals: dict[tuple[str | None, str], int] = {}

    def _next_ordinal(self, node_type: str) -> int:
        key = (self._divider, node_type)
        self._ordinals[key] = self._ordinals.get(key, -1) + 1
        return self._ordinals[key]

    def _path(self, node_type: str, ordinal: int) -> str:
        tag = f"{node_type}#{ordinal}"
        parts = [self._tab, self._section_title or "", self._divider or "", tag]
        return "/".join(parts)

    def _leaf(self, node_type: str, source_path: str, label: str, raw: JsonValue) -> WalkedNode:
        return WalkedNode(
            source_path=source_path,
            section_title=self._section_title,
            divider=self._divider,
            node_type=node_type,
            label=label,
            raw=raw,
        )

    def walk(self, nodes: Sequence[BodyNode]) -> Iterator[WalkedNode]:
        for node in nodes:
            if isinstance(node, CategoryDividerNode):
                self._divider = node.data.value
            elif isinstance(node, ExpandableSectionNode):
                yield from _Walker(self._tab, node.data.title).walk(node.data.children)
            elif isinstance(node, TitleValueNode):
                yield self._walk_title_value(node)
            elif isinstance(node, TitleLinkNode):
                yield self._walk_title_link(node)
            elif isinstance(node, NestedTitleValueNode):
                yield from self._walk_nested_title_value(node)
            elif isinstance(node, LabeledTableNode | IconTableNode):
                yield from self._walk_table(node)
            elif isinstance(node, BarGraphNode):
                yield self._walk_bar_graph(node)
            elif isinstance(node, SubscreenNavigatorNode):
                yield self._walk_subscreen_navigator(node)

    def _walk_title_value(self, node: TitleValueNode) -> WalkedNode:
        ordinal = self._next_ordinal("TitleValue")
        return self._leaf(
            "TitleValue", self._path("TitleValue", ordinal), node.data.title, list(node.data.value)
        )

    def _walk_title_link(self, node: TitleLinkNode) -> WalkedNode:
        ordinal = self._next_ordinal("TitleLink")
        raw: JsonValue = {"text": node.data.text, "link": node.data.link}
        return self._leaf("TitleLink", self._path("TitleLink", ordinal), node.data.title, raw)

    def _walk_nested_title_value(self, node: NestedTitleValueNode) -> Iterator[WalkedNode]:
        ordinal = self._next_ordinal("NestedTitleValue")
        base = self._path("NestedTitleValue", ordinal)
        top = node.data.topTitleValue
        yield self._leaf("NestedTitleValue", base, top.title, list(top.value))
        for child in node.data.children:
            path = f"{base}/{child.title}"
            yield self._leaf("NestedTitleValue", path, child.title, list(child.value))

    def _walk_table(self, node: LabeledTableNode | IconTableNode) -> Iterator[WalkedNode]:
        node_type = node.type
        ordinal = self._next_ordinal(node_type)
        base = self._path(node_type, ordinal)
        for row in node.data.data:
            raw = _table_row_raw(row, node.data.valueTitles)
            yield self._leaf(node_type, f"{base}/{row.label}", row.label, raw)

    def _walk_bar_graph(self, node: BarGraphNode) -> WalkedNode:
        ordinal = self._next_ordinal("BarGraph")
        raw: JsonValue = [{"label": b.label, "value": b.value} for b in node.data.data]
        return self._leaf("BarGraph", self._path("BarGraph", ordinal), node.data.title, raw)

    def _walk_subscreen_navigator(self, node: SubscreenNavigatorNode) -> WalkedNode:
        ordinal = self._next_ordinal("SubscreenNavigator")
        raw: JsonValue = {"buttonText": node.data.buttonText, "items": list(node.data.data)}
        path = self._path("SubscreenNavigator", ordinal)
        return self._leaf("SubscreenNavigator", path, node.data.title, raw)


def walk_page(tab: TabName, body: Sequence[BodyNode]) -> Iterator[WalkedNode]:
    """Flatten a tab's `bodyContent` (or `headerCardContent`) tree into
    `(source_path, label, raw)` leaves (module docstring)."""
    yield from _Walker(tab, None).walk(body)


# Two-element [in_state, out_of_state] header arrays (appendix E-ii §H).
_PAIRED_HEADER_KEYS: tuple[str, ...] = ("attendanceCost", "tuitionFeesCost")

# Scalar header keys walked as one leaf each (appendix E-ii §H) — excludes
# `undergraduateMajors`/`paymentPlans` (always empty, no signal to walk) and
# `headerCardContent` (walked as a body array by the caller, not a scalar).
_SCALAR_HEADER_KEYS: tuple[str, ...] = (
    "description",
    "alternativeName",
    "universityType",
    "populationType",
    "undergradPopulation",
    "gradPopulation",
    "malePercentage",
    "femalePercentage",
    "address",
    "admissionsPhone",
    "admissionsFax",
    "admissionsEmail",
    "phone",
    "admissionDeadline",
    "admissionDeadlineDate",
    "fullTimeFaculty",
    "partTimeFaculty",
    "roomBoardCost",
    "suppliesCost",
    "otherExpensesCost",
    "campusMapUrl",
    "city",
    "cityPopulation",
    "nearestMetro",
    "avgJanTemp",
    "avgSeptTemp",
    "rain",
    "freshmanHousingGuarantee",
)


def _address_raw(address: AddressHeader | None) -> JsonValue:
    if address is None:
        return None
    return {
        "street1": address.street1,
        "street2": address.street2,
        "city": address.city,
        "state": address.state,
        "zipCode": address.zipCode,
    }


def walk_header(tab: TabName, header: ProfileHeader) -> Iterator[WalkedNode]:
    """Flatten the header scalars into `(source_path, label, raw)` leaves,
    one per declared key — `source_path` follows the DDL's
    `"<tab>/@profile/<key>[/0|1]"` form (`school_facts.source_path`
    comment). `label` is the raw JSON key (headers carry no printed label;
    the mapper's `facts_keys.yaml` supplies the display label per §4.4's
    `label:` authoring rule).
    """
    for key in _SCALAR_HEADER_KEYS:
        value = getattr(header, key)
        if value is None:
            continue
        raw: JsonValue = _address_raw(value) if isinstance(value, AddressHeader) else value
        yield WalkedNode(
            source_path=f"{tab}/@profile/{key}",
            section_title=None,
            divider=None,
            node_type="header",
            label=key,
            raw=raw,
        )
    for key in _PAIRED_HEADER_KEYS:
        pair = getattr(header, key)
        if pair is None:
            continue
        for index, item in enumerate(pair):
            yield WalkedNode(
                source_path=f"{tab}/@profile/{key}/{index}",
                section_title=None,
                divider=None,
                node_type="header",
                label=key,
                raw=item,
            )
