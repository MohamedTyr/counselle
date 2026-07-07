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
    assert result["public_receipt"]["handle"] == handle
    assert result["result_for_agent"]["chars"] > 200
    assert result["result_for_agent"]["preview"]
    assert store.read(handle) is payload


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
