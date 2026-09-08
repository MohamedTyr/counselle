"""Wire response models for `GET /v1/schools/{unitid}/facts` (plan §5.2).

Response models are real pydantic return annotations (the `cds_admin`
convention, not the workspace `-> object` one — plan §5.2's "Auth, caching,
budget" bullet). Every student-facing word on these models (`display`,
`line`, `foot`) is composed server-side in `app/facts/service.py`; the
frontend authors none of it (plan §5.2, D3's absence-word grep).
"""

from __future__ import annotations

from typing import Any, Literal

from counselle_db.models import FrozenModel

FactStateWire = Literal["value", "not_reported", "not_fetched", "not_published", "not_collected"]
FactKindWire = Literal[
    "scalar", "link", "list", "table", "matrix", "distribution", "band", "ordinal"
]
FetchStateWire = Literal["ok", "partial", "not_fetched", "not_published"]


class SchoolIdentity(FrozenModel):
    unitid: int
    name: str
    city: str | None
    state: str | None
    control: Literal["public", "private", "private_for_profit"] | None
    undergraduates: int | None
    website_url: str | None
    domain: str | None


class Fact(FrozenModel):
    """One rendered fact. `display` is never blank — it is the absence word
    itself when `state != "value"` (plan §5.2)."""

    key: str
    label: str
    tab: str
    state: FactStateWire
    kind: FactKindWire
    display: str
    unit: str | None
    value: Any = None
    observed_at: str | None
    reported_period: str | None
    caveat_ids: tuple[str, ...] = ()


class FactGroup(FrozenModel):
    id: str
    label: str | None
    foot: str | None
    chart: dict[str, Any] | None = None
    facts: tuple[Fact, ...]


class FactSection(FrozenModel):
    id: str
    title: str
    fetch_state: FetchStateWire
    never_checked: bool
    line: str | None
    foot: str | None
    groups: tuple[FactGroup, ...]


class DeadlineRow(FrozenModel):
    round: str
    date: str | None
    display: str
    reported_period: str | None
    state: FactStateWire
    observed_at: str | None


class DeadlinesBlock(FrozenModel):
    rows: tuple[DeadlineRow, ...]
    foot: str


class CaveatWire(FrozenModel):
    id: str
    text: str
    severity: Literal["ordinary", "severe"]


class SchoolFactsResponse(FrozenModel):
    identity: SchoolIdentity
    has_collegedata: bool
    observed_at: str | None
    is_stale: bool
    freshness_line: str | None
    deadlines: DeadlinesBlock
    sections: tuple[FactSection, ...]
    caveats: tuple[CaveatWire, ...] = ()
