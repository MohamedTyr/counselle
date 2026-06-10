"""Vintage resolution — how to date any value (DATABASE_GUIDE §9, ARCHITECTURE §16).

``vintage_for`` turns (source, cycle context) into the citation parts
``(vintage, caveat)``: a human-readable vintage string plus an honesty caveat
where the data lags (Scorecard earnings reflect entry cohorts years back).
"""

import re
from datetime import datetime
from typing import Literal

Source = Literal["ipeds", "scorecard", "cds"]

#: The pipeline's current IPEDS collection vintage (provisional until final release).
#: Bump both constants when the pipeline re-ingests a new IPEDS cycle.
_IPEDS_CURRENT_VINTAGE = 2024
#: The prior-cycle IPEDS files carry the financial-aid data (SFA lags one year).
_IPEDS_AID_VINTAGE = 2023

_FILENAME_DATE_RE = re.compile(r"(\d{8})")  # MMDDYYYY in the Scorecard zip name
_EARNINGS_LAG_RE = re.compile(r"^earnings\..*?_(\d+)yr")


def _span(year: int) -> str:
    # IPEDS/CDS two-digit convention ("2024-25"; a century boundary would be "2099-00").
    return f"{year}-{(year + 1) % 100:02d}"


def _ipeds_vintage(cycle_year: int | None) -> str:
    if cycle_year is None:
        return "IPEDS"
    if cycle_year == _IPEDS_CURRENT_VINTAGE:
        return f"IPEDS {_span(cycle_year)} (provisional)"
    if cycle_year == _IPEDS_AID_VINTAGE:
        return f"IPEDS {_span(cycle_year)} financial-aid data"
    return f"IPEDS {_span(cycle_year)}"


def _scorecard_publication(scorecard_filename: str | None) -> tuple[str, int | None]:
    """Parse the MMDDYYYY stamp out of the Scorecard zip filename."""
    match = _FILENAME_DATE_RE.search(scorecard_filename or "")
    if not match:
        return "College Scorecard", None
    try:
        published = datetime.strptime(match.group(1), "%m%d%Y")
    except ValueError:
        return "College Scorecard", None
    return f"College Scorecard, published {published.strftime('%b %Y')}", published.year


def _earnings_lag_caveat(field_key: str | None, pub_year: int | None) -> str | None:
    if not field_key or pub_year is None:
        return None
    match = _EARNINGS_LAG_RE.match(field_key)
    if not match:
        return None
    entry_year = pub_year - int(match.group(1))
    return f"Earnings reflect students who entered around {entry_year}, not current students."


def vintage_for(
    source: Source,
    cycle_year: int | None,
    *,
    scorecard_filename: str | None = None,
    field_key: str | None = None,
) -> tuple[str, str | None]:
    """Resolve the (vintage, caveat) citation parts for one source + context."""
    if source == "ipeds":
        return _ipeds_vintage(cycle_year), None
    if source == "cds":
        if cycle_year is None:
            return "Common Data Set filed by the school", None
        return f"{_span(cycle_year)} Common Data Set filed by the school", None
    vintage, pub_year = _scorecard_publication(scorecard_filename)
    return vintage, _earnings_lag_caveat(field_key, pub_year)
