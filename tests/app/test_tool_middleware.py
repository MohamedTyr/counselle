"""Unit tests for the composed tool-result middleware pipeline."""

from __future__ import annotations

from datetime import date

from app.sources import SourceRegistry
from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from app.tool_overflow import ToolResultStore
from domain.envelope import Citation


def test_search_results_are_annotated_by_tool_name() -> None:
    registry = SourceRegistry()
    payload = {
        "results": [
            {
                "title": "Duke admissions",
                "url": "https://admissions.duke.edu",
                "snippet": "Apply.",
                "citation": Citation(
                    source="edu",
                    tier="official",
                    vintage="Retrieved Jul 7, 2026",
                    url="https://admissions.duke.edu",
                ).model_dump(mode="json"),
            }
        ]
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="search_school_site"
    )

    assert result["results"][0]["marker"] == "[1]"
    assert registry.entries[0].label == "Duke admissions"
    assert registry.entries[0].snippet == "Apply."


def test_mcp_envelopes_are_annotated_by_default() -> None:
    registry = SourceRegistry()
    payload = {
        "field": "admissions.acceptance_rate",
        "label": "Acceptance Rate",
        "display": "6%",
        "available": True,
        "citation": Citation(
            source="profile", tier="official", vintage="Profile 2024",
            school_unitid=198419, profile_sha256="a" * 64,
        ).model_dump(mode="json"),
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="get_values"
    )

    assert result["marker"] == "[1]"
    assert registry.entries[0].label == "Profile 2024"


def test_profile_normalization_preserves_only_typed_provenance_fields() -> None:
    payload = {
        "school": {"unitid": 198419, "name": "Duke University"},
        "profile_version": "2026-07-13",
        "profile_snapshot_date": "2024-12-31",
        "profile_sha256": "a" * 64,
        "groups": [
            {
                "id": "location",
                "rows": [
                    {
                        "ref": "location.city",
                        "label": "CITY",
                        "display": "Durham",
                        "value": "Durham",
                        "available": True,
                        "caveat_kinds": ["profile_snapshot"],
                        "provenance": {
                            "status": "present",
                            "chosen_source": "HD2024",
                            "source_column": "CITY",
                            "source_vintage": "2024:RPTMTH=1",
                            "file_sha256": "b" * 64,
                            "raw_value": "Durham",
                            "normalized_value": "Durham",
                            "normalization": "deterministic:CITY",
                            "unexpected_internal_field": "must not cross",
                        },
                    }
                ],
            }
        ],
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(), tool_name="get_school_profile"
    )

    # The model reads a compact row; provenance (and anything internal inside
    # it) never crosses, and the snapshot caveat every row shares is stated once.
    assert result["groups"][0]["rows"] == [
        {
            "profile_field": "location.city",
            "label": "CITY",
            "display": "Durham",
            "marker": None,
            "available": True,
        }
    ]
    assert "unexpected_internal_field" not in str(result)
    assert [caveat["kind"] for caveat in result["caveats"]] == ["profile_snapshot"]


def test_get_domain_payload_passes_through_unminted() -> None:
    """school-data-v3 Phase 3: `_normalize_db_payload's minting set
    is `{get_facts, get_school_profile, resolve_school}` -- `get_domain` is
    no longer one of them (its CDS-era branch is retired with the parked
    packet/manifest machinery), so its payload passes through untouched
    rather than growing a `citation`/`marker`."""
    payload = {
        "school": {"unitid": 130794, "name": "Yale University"},
        "rows": [{"ref": "enrollment.total_undergraduate", "available": True, "value": 6814}],
    }

    result = process_tool_result(payload, ToolMiddlewareContext(), tool_name="get_domain")

    assert result == payload


def test_overflow_runs_after_annotation() -> None:
    registry = SourceRegistry()
    store = ToolResultStore()
    payload = {
        "results": [
            {
                "title": "Large",
                "url": "https://example.edu",
                "snippet": "x" * 500,
                "citation": Citation(
                    source="edu",
                    tier="official",
                    vintage="Retrieved Jul 7, 2026",
                    url="https://example.edu",
                ).model_dump(mode="json"),
            }
        ]
    }

    result = process_tool_result(
        payload,
        ToolMiddlewareContext(registry=registry, overflow_store=store, max_result_chars=120),
        tool_name="search_web",
    )

    assert result["status"] == "overflow"
    full = store.read(result["result_for_agent"]["handle"])
    assert full["results"][0]["marker"] == "[1]"


def test_tool_ui_is_demoted_to_public_receipt_before_model_result() -> None:
    payload = {
        "ok": True,
        "ui": {"widget": "task_added", "data": {"task_id": "t1", "title": "Visit Duke"}},
    }

    result = process_tool_result(payload, ToolMiddlewareContext(), tool_name="write_plan")

    assert "ui" not in result
    assert result["public_receipt"]["ui"] == {
        "widget": "task_added",
        "data": {"task_id": "t1", "title": "Visit Duke"},
    }
    assert result["ok"] is True


def test_invalid_tool_ui_is_stripped_from_model_result() -> None:
    payload = {"ok": True, "ui": {"widget": "task_added", "data": "not an object"}}

    result = process_tool_result(payload, ToolMiddlewareContext(), tool_name="write_plan")

    assert result == {"ok": True}


def test_blank_tool_ui_widget_is_stripped_from_model_result() -> None:
    payload = {"ok": True, "ui": {"widget": "  ", "data": {"title": "Visit Duke"}}}

    result = process_tool_result(payload, ToolMiddlewareContext(), tool_name="write_plan")

    assert result == {"ok": True}


def test_render_viz_result_keeps_agent_values_when_large() -> None:
    store = ToolResultStore()
    rows = [
        {
            "label": f"Metric {row}",
            "cells": [
                {
                    "school": f"School {col}",
                    "field": f"field.{row}.{col}",
                    "label": f"Metric {row}",
                    "display": f"{row * col}% cited display value",
                    "available": True,
                    "marker": f"[{row * 5 + col + 1}]",
                }
                for col in range(5)
            ],
        }
        for row in range(12)
    ]
    payload = {
        "ok": True,
        "status": "success",
        "summary": "comparison_table rendered with 60 cited values",
        "viz": "comparison_table rendered with 60 values",
        "sources": [f"[{index}]" for index in range(1, 61)],
        "result_for_agent": {
            "type": "comparison_table",
            "title": "Large comparison",
            "schools": [
                {"unitid": 10_000 + index, "name": f"School {index}"}
                for index in range(5)
            ],
            "rows": rows,
        },
        "public_receipt": {
            "viz_type": "comparison_table",
            "value_count": 60,
            "schools": [f"School {index}" for index in range(5)],
        },
    }

    result = process_tool_result(
        payload,
        ToolMiddlewareContext(overflow_store=store, max_result_chars=120),
        tool_name="render_viz",
    )

    assert result["status"] == "success"
    assert result["public_receipt"]["value_count"] == 60
    assert result["result_for_agent"]["rows"][11]["cells"][4]["display"] == (
        "44% cited display value"
    )
    assert result["result_for_agent"]["rows"][11]["cells"][4]["marker"] == "[60]"
    assert store.dump() == {}


# --- school-data-v3 Phase 3: the `db` citation-minting matrix ---
#
# get_facts / get_school_profile / resolve_school each mint exactly one `db`
# citation for the school they name; query_database mints none (plan
# §5.4/§6a). `tier` is present and `None` for every `db` citation, and no
# `db` citation ever renders a vintage with an empty date slot.


def test_resolve_school_mints_one_db_citation_with_identity_vintage() -> None:
    registry = SourceRegistry()
    payload = {
        "status": "match",
        "school": {"unitid": 198419, "name": "Duke University"},
        "data": {
            "has_collegedata": True,
            "facts_updated_at": "2026-08-01T00:00:00+00:00",
            "fact_count": 210,
            "tabs": {"admissions": "ok"},
        },
        "profile_snapshot_date": "2026-01-02",
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="resolve_school"
    )

    assert result["marker"] == "[1]"
    assert len(registry) == 1
    citation = registry.entries[0].citation
    assert citation.source == "db"
    assert citation.tier is None
    assert citation.school_unitid == 198419
    assert citation.vintage == "Counselle school data · identity profile from 2026-01-02"
    assert citation.facts_updated_at is None


def test_resolve_school_candidates_and_not_found_mint_nothing() -> None:
    registry = SourceRegistry()
    for payload in (
        {"status": "candidates", "candidates": [], "hint": "..."},
        {"status": "not_found", "message": "..."},
    ):
        result = process_tool_result(
            payload, ToolMiddlewareContext(registry=registry), tool_name="resolve_school"
        )
        assert "marker" not in result
    assert len(registry) == 0


def test_get_school_profile_mints_one_db_citation_with_null_tier() -> None:
    registry = SourceRegistry()
    payload = {
        "school": {"unitid": 198419, "name": "Duke University"},
        "profile_version": "2026-07-13",
        "profile_snapshot_date": "2026-01-02",
        "profile_sha256": "a" * 64,
        "groups": [
            {
                "id": "location",
                "rows": [
                    {
                        "ref": "location.city",
                        "label": "City",
                        "display": "Durham",
                        "value": "Durham",
                        "available": True,
                    }
                ],
            }
        ],
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="get_school_profile"
    )

    assert len(registry) == 1
    citation = registry.entries[0].citation
    assert citation.source == "db"
    assert citation.tier is None
    assert citation.vintage == "Counselle school data · identity profile from 2026-01-02"
    row = result["groups"][0]["rows"][0]
    assert row["marker"] == "[1]"
    assert result["citation"]["source"] == "db"


def test_get_facts_mints_one_db_citation_with_facts_vintage_and_per_fact_vintage() -> None:
    registry = SourceRegistry()
    payload = {
        "school": {"unitid": 198419, "name": "Duke University"},
        "status": {
            "has_collegedata": True,
            "facts_updated_at": "2026-08-15T00:00:00+00:00",
            "fact_count": 1,
            "tabs": {"admissions": "ok"},
        },
        "rows": [
            {
                "fact_key": "admissions.rate",
                "tab": "admissions",
                "section": "getting-in",
                "label": "Admit rate",
                "value": 0.06,
                "display": "6%",
                "unit": "percent",
                "value_type": "number",
                "value_num": 0.06,
                "value_text": None,
                "value_bool": None,
                "value_date": None,
                "reported_period": "2025-26",
                "reported_period_year": 2025,
                "observed_at": "2026-08-15T00:00:00+00:00",
            }
        ],
        "profile_snapshot_date": "2026-01-02",
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="get_facts"
    )

    assert len(registry) == 1
    citation = registry.entries[0].citation
    assert citation.source == "db"
    assert citation.tier is None
    assert citation.vintage == "Counselle school data · checked August 2026"
    assert citation.facts_updated_at == date(2026, 8, 15)
    # The model sees one compact row per fact: what it cites, and nothing that
    # repeats per row (the shared citation rides once at top level).
    assert result["rows"] == [
        {
            "fact_key": "admissions.rate",
            "label": "Admit rate",
            "display": "6%",
            "vintage": "Counselle school data · 2025-26 · checked August 2026",
            "marker": "[1]",
        }
    ]
    assert result["marker"] == "[1]"
    assert result["citation"]["vintage"] == "Counselle school data · checked August 2026"


def test_get_facts_falls_back_to_identity_vintage_when_facts_updated_at_is_null() -> None:
    """No `db` citation ever renders a vintage with an empty date slot: a
    school with no CollegeData crawl mints the identity vintage instead of a
    facts vintage over a null `facts_updated_at`."""
    registry = SourceRegistry()
    payload = {
        "school": {"unitid": 198419, "name": "Duke University"},
        "status": {
            "has_collegedata": False,
            "facts_updated_at": None,
            "fact_count": 0,
            "tabs": {},
        },
        "rows": [],
        "profile_snapshot_date": "2026-01-02",
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="get_facts"
    )

    assert len(registry) == 1
    citation = registry.entries[0].citation
    assert citation.source == "db"
    assert citation.facts_updated_at is None
    assert citation.vintage == "Counselle school data · identity profile from 2026-01-02"
    assert result["rows"] == []


def test_get_school_profile_and_get_facts_yield_two_rail_entries_with_distinct_vintages() -> None:
    """A turn calling both `get_school_profile` and `get_facts` for one
    school gets two rail entries — the identity vintage and the facts
    vintage never collapse into one (plan §5.4's per-vintage `source_key`)."""
    registry = SourceRegistry()
    profile_payload = {
        "school": {"unitid": 198419, "name": "Duke University"},
        "profile_version": "2026-07-13",
        "profile_snapshot_date": "2026-01-02",
        "profile_sha256": "a" * 64,
        "groups": [
            {
                "id": "location",
                "rows": [
                    {
                        "ref": "location.city",
                        "label": "City",
                        "display": "Durham",
                        "value": "Durham",
                        "available": True,
                    }
                ],
            }
        ],
    }
    facts_payload = {
        "school": {"unitid": 198419, "name": "Duke University"},
        "status": {
            "has_collegedata": True,
            "facts_updated_at": "2026-08-15T00:00:00+00:00",
            "fact_count": 1,
            "tabs": {"admissions": "ok"},
        },
        "rows": [
            {
                "fact_key": "admissions.rate",
                "tab": "admissions",
                "section": "getting-in",
                "label": "Admit rate",
                "value": 0.06,
                "display": "6%",
                "unit": "percent",
                "value_type": "number",
                "value_num": 0.06,
                "value_text": None,
                "value_bool": None,
                "value_date": None,
                "reported_period": None,
                "reported_period_year": None,
                "observed_at": "2026-08-15T00:00:00+00:00",
            }
        ],
        "profile_snapshot_date": "2026-01-02",
    }

    process_tool_result(
        profile_payload, ToolMiddlewareContext(registry=registry), tool_name="get_school_profile"
    )
    process_tool_result(
        facts_payload, ToolMiddlewareContext(registry=registry), tool_name="get_facts"
    )

    assert len(registry) == 2
    vintages = {entry.citation.vintage for entry in registry.entries}
    assert vintages == {
        "Counselle school data · identity profile from 2026-01-02",
        "Counselle school data · checked August 2026",
    }


def test_query_database_mints_no_db_citation() -> None:
    """query_database's result carries no `citation` key anywhere in its
    payload, so the registry stays empty -- the honesty carriers for a
    cross-school result are the coverage-denominator caveat and the
    printed-name sentence `counselle_db.sql_guard` already appends, not a
    per-row `db` citation (appendix F-iii: the validator requires
    `school_unitid`, which a cross-school result has none of)."""
    registry = SourceRegistry()
    payload = {
        "columns": ("name",),
        "rows": [("Duke University",)],
        "row_count": 1,
        "truncated": False,
        "as_of": "2026-09-01T00:00:00+00:00",
        "warning": "Raw query rows bypass typed normalization.",
        "coverage": [],
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="query_database"
    )

    assert len(registry) == 0
    assert result == payload


def test_compact_facts_rows_keep_caveats_and_leave_unavailable_untouched() -> None:
    """The model's compact `get_facts` rows drop only repeated envelope
    fields: a row's caveats and the per-key absence states survive."""
    from app.tool_middleware import compact_for_model

    unavailable = [
        {"fact_key": "admissions.yield", "state": "not_reported", "display": "Not reported"}
    ]
    result = {
        "school": {"unitid": 1, "name": "A"},
        "rows": [
            {
                "field": "admissions.rate",
                "label": "Admit rate",
                "display": "6%",
                "raw": 0.06,
                "vintage": "v",
                "marker": "[1]",
                "caveats": [{"kind": "stale_facts", "text": "old"}],
                "observed_at": "2026-08-15",
            }
        ],
        "unavailable": unavailable,
    }

    compact = compact_for_model(result, "get_facts")

    assert compact["rows"] == [
        {
            "fact_key": "admissions.rate",
            "label": "Admit rate",
            "display": "6%",
            "vintage": "v",
            "marker": "[1]",
            "caveats": [{"kind": "stale_facts", "text": "old"}],
        }
    ]
    assert compact["unavailable"] is unavailable
    assert compact_for_model(result, "get_school_profile") is result


def test_compact_profile_keeps_citation_and_value_count_with_an_unavailable_row() -> None:
    """An unavailable row carries no citation; the profile's one citation (its
    vintage) must still reach the model, and the step receipt must still count
    the values that were read."""
    from app.steps import StepMapper

    row = {"label": "CITY", "caveat_kinds": ["profile_snapshot"]}
    payload = {
        "school": {"unitid": 198419, "name": "Duke University"},
        "profile_version": "2026-07-13",
        "profile_snapshot_date": "2024-12-31",
        "profile_sha256": "a" * 64,
        "groups": [
            {
                "id": "location",
                "rows": [
                    {**row, "ref": "location.website", "display": "", "available": False},
                    {
                        **row,
                        "ref": "location.city",
                        "display": "Durham",
                        "value": "Durham",
                        "available": True,
                    },
                ],
            }
        ],
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=SourceRegistry()), tool_name="get_school_profile"
    )

    vintage = "Counselle school data · identity profile from 2024-12-31"
    assert result["citation"]["vintage"] == vintage
    rows = result["groups"][0]["rows"]
    assert [row["display"] for row in rows] == ["not available", "Durham"]
    assert rows[1]["marker"] == "[1]"
    assert StepMapper._get_school_profile_kwargs(result)["value_count"] == 1
