"""Read-only school reference catalog assembly for one application cycle."""

from __future__ import annotations

import re

from app.caveats import render_caveat
from app.tool_middleware import _FACTS_VINTAGE
from app.workspace.models import SchoolReference
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.service import get_facts
from domain.envelope import Citation, CitationEnvelope
from domain.facts.state import is_stale

# CollegeData publishes only the school's current admission testing policy --
# no CDS-style per-edition history -- so there is one fact key, not a
# per-cycle clarification narrative (plan §5.6).
_TEST_POLICY_KEY = "admissions.test_policy_sat_or_act"


async def get_school_reference(
    catalog: Catalog,
    *,
    unitid: int,
    cycle_year: int | None,
) -> SchoolReference:
    """Load the compatible pipeline test policy for one application cycle.

    Query failures intentionally propagate. A database failure must never be
    represented as an honestly loaded, empty catalog.
    """
    if cycle_year is None:
        return SchoolReference(status="cycle_required", cycle_year=None)

    test_policy = await _compatible_test_policy(catalog, unitid)
    return SchoolReference(
        status="loaded",
        cycle_year=cycle_year,
        populated=bool(test_policy and test_policy.available),
        test_policy=test_policy,
    )


async def _compatible_test_policy(catalog: Catalog, unitid: int) -> CitationEnvelope | None:
    """CollegeData's admission-requirements page is the school's current
    published policy, so this is a freshness gate now, not a cycle gate
    (plan §5.6): available with a `db` citation when the fact was confirmed
    within `facts_stale_days`, else unavailable with a `stale_facts`
    disclosure. The clarification renders the source's printed phrase
    verbatim (`display`), never a re-labelled category."""
    settings = getattr(catalog, "settings", None) or get_settings()
    result = await get_facts(catalog, unitid, keys=[_TEST_POLICY_KEY])
    row = next((item for item in result.rows if item.fact_key == _TEST_POLICY_KEY), None)
    if row is None:
        return None
    checked = row.observed_at.strftime("%B %Y")
    if is_stale(row.observed_at, settings.facts_stale_days):
        return CitationEnvelope(
            field=row.fact_key,
            label=row.label,
            display="not available",
            available=False,
            caveats=(render_caveat("stale_facts", checked=checked),),
        )
    citation = Citation(
        source="db",
        vintage=_FACTS_VINTAGE.format(month_year=checked),
        school_unitid=unitid,
        facts_updated_at=row.observed_at.date(),
    )
    return CitationEnvelope(
        field=row.fact_key,
        label=row.label,
        display=row.display,
        unit=row.unit,
        raw=row.value,
        available=True,
        citation=citation,
    )


def _vintage_matches_cycle(vintage: str, cycle_year: int) -> bool:
    normalized = vintage.replace("–", "-").replace("—", "-")
    prior = cycle_year - 1
    return bool(
        re.search(
            rf"\b{prior}\s*[-/]\s*(?:{cycle_year}|{str(cycle_year)[-2:]})\b",
            normalized,
        )
    )
