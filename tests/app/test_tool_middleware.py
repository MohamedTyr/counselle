"""Unit tests for the composed tool-result middleware pipeline."""

from __future__ import annotations

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
            source="ipeds", tier="official", vintage="IPEDS 2024-25"
        ).model_dump(mode="json"),
    }

    result = process_tool_result(
        payload, ToolMiddlewareContext(registry=registry), tool_name="get_values"
    )

    assert result["marker"] == "[1]"
    assert registry.entries[0].label == "IPEDS 2024-25"


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
