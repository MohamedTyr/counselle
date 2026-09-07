"""Pins the cds_library reader view list to exactly six names (plan §3.2/§3.3).

Full scope (plan §3.3): "one owner for the view list" -- the seed
(deploy/seed/cds_library_schema.sql), scripts/finish_supabase_staging.py, and
docs/DATABASE_GUIDE.md §1 should all name the same six views. Under Phase 0,
only the seed is rewritten: finish_supabase_staging.py still carries the
pre-v3 five-view list and is rewritten in Phase 4 (plan §7), and
DATABASE_GUIDE.md's view table is rewritten in Phase 5. Cross-checking this
test against either file's *current* content would therefore fail on a
correct Phase 0 changeset for a reason that has nothing to do with this
phase's own work.

Phase 0's job (per the plan's own exit-criteria note: "this test just needs
the seed's view list to already match the target list you'll wire in
Phase 4") is narrower: pin the seed's view list to the target six-view
vocabulary now, so Phase 4/5 have one unambiguous list to wire the other two
files to, and so any accidental drift inside the seed itself (a view created
under `CREATE OR REPLACE VIEW` but never GRANTed, or vice versa) is caught
immediately. The three-way cross-file equality check is deferred to whichever
phase actually touches the second and third file.
"""

from __future__ import annotations

import re
from pathlib import Path

SEED_FILE = Path(__file__).resolve().parents[1] / "deploy" / "seed" / "cds_library_schema.sql"

# The target six-view vocabulary (plan §3.2): the single source of truth for
# this test. Phase 4 points finish_supabase_staging.py at this same list;
# Phase 5 points docs/DATABASE_GUIDE.md §1 at it.
EXPECTED_VIEWS = frozenset(
    {
        "school_profiles",
        "current_school_facts",
        "school_facts_sql",
        "school_explore",
        "school_data_status",
        "fact_coverage",
    }
)

_CREATE_VIEW_RE = re.compile(r"CREATE OR REPLACE VIEW cds_library\.(\w+)")
_READER_GRANT_BLOCK_RE = re.compile(
    r"GRANT SELECT ON TABLE\s+(.*?)\s+TO cds_library_reader;", re.DOTALL
)


def _seed_text() -> str:
    return SEED_FILE.read_text(encoding="utf-8")


def test_seed_defines_exactly_the_six_target_views() -> None:
    created = set(_CREATE_VIEW_RE.findall(_seed_text()))
    assert created == EXPECTED_VIEWS, (
        f"deploy/seed/cds_library_schema.sql defines {sorted(created)}, "
        f"expected exactly {sorted(EXPECTED_VIEWS)}"
    )


def test_seed_grants_the_reader_role_exactly_the_six_views() -> None:
    """Catches a view created but never granted to cds_library_reader, or the reverse."""
    match = _READER_GRANT_BLOCK_RE.search(_seed_text())
    assert match is not None, "no `GRANT SELECT ON TABLE ... TO cds_library_reader;` block found"
    granted = {
        name.split(".", 1)[1]
        for name in (line.strip().rstrip(",") for line in match.group(1).splitlines())
        if name.strip()
    }
    assert granted == EXPECTED_VIEWS, (
        f"cds_library_reader is granted {sorted(granted)}, "
        f"expected exactly {sorted(EXPECTED_VIEWS)}"
    )


def test_seed_grants_no_base_table_to_the_reader_role() -> None:
    """cds_library_reader must never appear in a GRANT naming a base table."""
    base_tables = {
        "schools",
        "collegedata_schools",
        "page_snapshots",
        "school_pages",
        "school_facts",
        "school_explore_rows",
        "fact_coverage_counts",
        "facts_jobs",
        "crawl_runs",
    }
    match = _READER_GRANT_BLOCK_RE.search(_seed_text())
    assert match is not None
    granted = {
        name.split(".", 1)[1]
        for name in (line.strip().rstrip(",") for line in match.group(1).splitlines())
        if name.strip()
    }
    assert granted.isdisjoint(base_tables), (
        f"cds_library_reader is granted base table(s) {sorted(granted & base_tables)} "
        "-- the reader must only ever see views"
    )
