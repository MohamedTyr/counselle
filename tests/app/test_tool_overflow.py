"""Unit tests for Agent V1 tool-result overflow helpers."""

from __future__ import annotations

from app.tool_overflow import (
    ToolResultStore,
    json_sketch,
    reduce_tool_result,
    truncate_text,
)


def test_small_tool_result_passes_through_byte_identical() -> None:
    store = ToolResultStore()
    payload = {"rows": [{"value": "small"}]}

    result = reduce_tool_result(payload, store, max_chars=1_000)

    assert result is payload


def test_oversized_tool_result_spills_to_store_and_returns_reference() -> None:
    store = ToolResultStore()
    payload = {"rows": [{"value": "x" * 2000}]}

    result = reduce_tool_result(payload, store, max_chars=200)

    assert result["status"] == "overflow"
    handle = result["result_for_agent"]["handle"]
    assert "handle" not in result["public_receipt"]
    assert "chars" not in result["public_receipt"]
    assert result["result_for_agent"]["chars"] > 200
    assert result["result_for_agent"]["preview"]
    # Spill storage is a durable-safe copy (hidden evidence telemetry is
    # scrubbed recursively), not the caller's mutable object identity.
    assert store.read(handle) == payload


def test_oversized_search_result_preserves_public_receipt_metadata() -> None:
    store = ToolResultStore()
    payload = {
        "results": [
            {"title": "A", "url": "https://www.duke.edu/a", "snippet": "x" * 500},
            {"title": "B", "url": "https://admissions.duke.edu/b", "snippet": "y" * 500},
        ]
    }

    result = reduce_tool_result(payload, store, max_chars=200)

    assert result["status"] == "overflow"
    assert result["public_receipt"]["result_count"] == 2
    assert set(result["public_receipt"]) == {"result_count"}


def test_oversized_domain_result_uses_available_value_count() -> None:
    store = ToolResultStore()
    payload = {
        "rows": [{"label": "x" * 500}],
        "availability": {
            "configured": 3,
            "verified": 3,
            "available": 2,
            "not_in_template_version": 1,
        },
    }

    result = reduce_tool_result(payload, store, max_chars=200)

    assert result["public_receipt"]["value_count"] == 2


def test_oversized_resolve_candidates_preserves_safe_receipt() -> None:
    store = ToolResultStore()
    payload = {
        "status": "candidates",
        "candidates": [
            {"unitid": 1, "name": "Washington University", "city": "x" * 500},
            {"unitid": 2, "name": "University of Washington", "city": "y" * 500},
        ],
        "hint": "z" * 500,
    }
    result = reduce_tool_result(payload, store, max_chars=200)
    assert result["public_receipt"] == {
        "status": "candidates",
        "result_count": 2,
        "schools": ["Washington University", "University of Washington"],
    }


def test_oversized_result_preserves_public_receipt_ui() -> None:
    store = ToolResultStore()
    payload = {
        "rows": [{"value": "x" * 2000}],
        "public_receipt": {
            "ui": {"widget": "task_added", "data": {"task_id": "t1", "title": "Visit Duke"}}
        },
    }

    result = reduce_tool_result(payload, store, max_chars=200)

    assert result["status"] == "overflow"
    assert result["public_receipt"]["ui"] == {
        "widget": "task_added",
        "data": {"task_id": "t1", "title": "Visit Duke"},
    }


def test_oversized_result_does_not_preserve_blank_public_receipt_ui_widget() -> None:
    store = ToolResultStore()
    payload = {
        "rows": [{"value": "x" * 2000}],
        "public_receipt": {"ui": {"widget": "", "data": {"title": "Visit Duke"}}},
    }

    result = reduce_tool_result(payload, store, max_chars=200)

    assert result["status"] == "overflow"
    assert "ui" not in result["public_receipt"]


def test_oversized_binary_result_spills_by_byte_length() -> None:
    store = ToolResultStore()
    payload = b"x" * 500

    result = reduce_tool_result(payload, store, max_chars=100)

    assert result["status"] == "overflow"
    assert result["result_for_agent"]["chars"] == 500
    assert store.read(result["result_for_agent"]["handle"]) == payload


def test_read_missing_tool_result_returns_safe_error() -> None:
    result = ToolResultStore().read("missing")

    assert "No spilled tool result" in result["error"]


def test_store_dumps_and_rehydrates_plain_state() -> None:
    store = ToolResultStore()
    text_handle = store.put({"rows": [{"value": "kept"}]})
    bytes_handle = store.put(b"raw bytes")

    dumped = store.dump()
    rehydrated = ToolResultStore(dumped)

    assert rehydrated.read(text_handle) == {"rows": [{"value": "kept"}]}
    assert rehydrated.read(bytes_handle) == b"raw bytes"


def test_json_sketch_and_truncation_are_bounded() -> None:
    assert json_sketch({"a": [1, 2], "b": {"c": 3}}) == "{'a': list, 'b': dict}"

    text = "a" * 100 + "b" * 100
    truncated = truncate_text(text, 50)

    assert len(truncated) < len(text)
    assert "omitted" in truncated
