"""The whole fact-state set, one function (plan §5.1) — `fact_state` and its
section-level sibling `section_state` are the *only* place the absence rule
lives. The facts endpoint, the agent's `get_facts`, the caveat emitter, and
the explore exclusion accounting all call these; nothing downstream
re-derives a state from raw statuses on its own.

Also hosts the code-owned, backend-authored strings this module accumulates
across phases — `BAND_CAPTION` and `ENTRANCE_DIFFICULTY_NOTE` are needed
starting this phase, because `config/assets/facts_sections.yaml` (Phase 1)
already references them by name via `foot_ref:`; `MAJORS_MATCH_NOTE`,
`RELIGIOUS_AFFILIATION_NOTE` and the two `not_fetched` cause clauses land
later, as their Phase 2/3 consumers do (see this unit's final report for why
they are not added here).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Literal

from domain.facts.models import FactState, FetchState, NormalizedValue, PageStatus, TabName

_StatusClass = Literal["ok", "not_found", "not_fetched"]


def _status_class(status: PageStatus) -> _StatusClass:
    if status == "ok":
        return "ok"
    if status == "not_found":
        return "not_found"
    return "not_fetched"  # http_error | build_id_rotated | parse_error | never_fetched

__all__ = [
    "BAND_CAPTION",
    "ENTRANCE_DIFFICULTY_NOTE",
    "fact_state",
    "is_stale",
    "section_state",
]

# plan §5.2's group `foot_ref: BAND_CAPTION` (getting-in/test-detail) — one
# authored copy, delivered on the wire everywhere a score band appears.
BAND_CAPTION = (
    "This band holds the middle half of the enrolled students who reported a score. "
    "We don't know how many reported one — treat it as context, not a cutoff."
)

# plan §5.2's group `foot_ref: ENTRANCE_DIFFICULTY_NOTE` (getting-in/selectivity-rating).
ENTRANCE_DIFFICULTY_NOTE = (
    "A published selectivity rating, not a measured value. The admit rate and score "
    "bands below are the evidence; this is someone's summary of them."
)


def fact_state(
    has_row: bool,
    value: NormalizedValue | None,
    page_status: PageStatus,
    has_collegedata: bool,
) -> FactState:
    """Resolve one fact's state (plan §5.1's table, verbatim).

    `has_row` and `value` are distinct on purpose: `has_row=True, value=None`
    is a stored *explicit* absence observation ("Not reported" on an `ok`
    page) — a real, present row — while `has_row=False` means no row exists
    at all, and the fact's state then depends on why (`page_status`). A
    legitimate `0`/`False` value is a non-`None` `NormalizedValue` and always
    resolves to `"value"`, at full weight.
    """
    if not has_collegedata:
        return "not_collected"
    if has_row:
        return "value" if value is not None else "not_reported"
    if page_status == "not_found":
        return "not_published"
    if page_status == "ok":
        return "not_reported"
    return "not_fetched"  # http_error | build_id_rotated | parse_error | never_fetched


def section_state(tab_statuses: Mapping[TabName, PageStatus]) -> tuple[FetchState, bool]:
    """Resolve a section's `(fetch_state, never_checked)` from its contributing tabs' statuses.

    `ok` when every contributing tab is `ok`; `not_published`/`not_fetched`
    when *all* non-`ok` contributors share one status class (`not_found`, or
    the four-member "checked but failed" class); `partial` otherwise. A
    section whose only contributing tab is `not_found` is `not_published`,
    never `partial`.

    `never_checked` is `True` only when every non-`ok` contributing tab is
    literally `never_fetched` — a mix with any other failure status is the
    stronger claim ("we checked, and it failed"), never "we never checked".
    """
    if not tab_statuses:
        raise ValueError("section_state requires at least one contributing tab")
    statuses = tuple(tab_statuses.values())
    classes = {_status_class(status) for status in statuses}
    if classes == {"ok"}:
        return "ok", False
    non_ok = [status for status in statuses if status != "ok"]
    never_checked = all(status == "never_fetched" for status in non_ok)
    if classes == {"not_found"}:
        return "not_published", never_checked
    if classes == {"not_fetched"}:
        return "not_fetched", never_checked
    return "partial", never_checked


def is_stale(observed_at: datetime | None, stale_days: int, *, now: datetime | None = None) -> bool:
    """Whether an observation is older than `stale_days`.

    `observed_at=None` (no observation at all) is never "stale" — that is a
    different state (`not_reported`/`not_fetched`/etc.), not staleness of a
    value we hold. `now` is an injection seam for tests; callers normally
    omit it.
    """
    if observed_at is None:
        return False
    current = now if now is not None else datetime.now(observed_at.tzinfo)
    return (current - observed_at) > timedelta(days=stale_days)
