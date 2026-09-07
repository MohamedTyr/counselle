"""Pins `domain.facts.models.TAB_NAMES` equal to `cds_library.tab_names()` in the
committed seed (plan §7 Phase 1 exit criteria) — a live-DB assertion would
duplicate this for no benefit, since the seed *is* what provisions the domain.

Lives in `tests/`, not `domain/facts/`: the purity gate (`test_purity.py`)
forbids `domain/facts/` from reading any file, including the seed SQL.
"""

import re
from pathlib import Path

from domain.facts.models import PAGE_STATUSES, TAB_NAMES

SEED_PATH = Path(__file__).resolve().parents[3] / "deploy" / "seed" / "cds_library_schema.sql"


def test_tab_names_match_the_committed_seed_function() -> None:
    sql = SEED_PATH.read_text()
    match = re.search(r"tab_names\(\)[\s\S]*?SELECT ARRAY\[(?P<items>[^\]]+)\]", sql)
    assert match, "cds_library.tab_names() not found in the committed seed"
    seed_tabs = tuple(item.strip().strip("'") for item in match["items"].split(","))
    assert seed_tabs == TAB_NAMES
    assert len(TAB_NAMES) == 6


def test_page_statuses_match_the_committed_check_constraint() -> None:
    sql = SEED_PATH.read_text()
    match = re.search(r"last_status\s+text[\s\S]*?CHECK \(last_status IN \(([^)]+)\)", sql)
    assert match
    seed_statuses = {item.strip().strip("'") for item in match[1].split(",")}
    assert set(PAGE_STATUSES) == seed_statuses
