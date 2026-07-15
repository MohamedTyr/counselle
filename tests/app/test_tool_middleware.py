"""Unit tests for the composed tool-result middleware pipeline."""

from __future__ import annotations

from datetime import UTC, datetime

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


def test_overflow_store_scrubs_hidden_cds_evidence_but_keeps_runtime_promotion() -> None:
    registry = SourceRegistry()
    store = ToolResultStore()
    citation = Citation(
        source="cds",
        tier="official",
        vintage="Common Data Set 2024-25",
        document_sha256="a" * 64,
        source_kind="cds_pdf",
        retrieved_at=datetime(2026, 7, 1, tzinfo=UTC),
        academic_year=2024,
        manifest_version="5.0.1",
        school_unitid=198419,
    )
    payload = {
        "rows": [
            {
                "field": "admissions.applicants",
                "label": "Applicants",
                "display": "50,000",
                "available": True,
                "citation": citation.model_dump(mode="json"),
                "evidence": {
                    "eid": "admissions.applicants",
                    "value_display": "50,000",
                    "label": "Applicants",
                    "page": 3,
                    "excerpt": "secret source excerpt " + "x" * 500,
                },
            }
        ]
    }

    result = process_tool_result(
        payload,
        ToolMiddlewareContext(registry=registry, overflow_store=store, max_result_chars=120),
        tool_name="get_values",
    )

    compact = str(result)
    assert "[[evidence:1:admissions.applicants]]" in compact
    durable = str(store.dump())
    assert "[[evidence:" not in durable
    assert "secret source excerpt" not in durable
    assert registry.promote_pending_evidence(1, "admissions.applicants")
    assert registry.entries[0].evidence[0].eid == "admissions.applicants"


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
