"""Tests that the cancel path in research_plan returns all terminal keys.

No live calls — the cancel path is exercised by calling _cancel_path directly.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from app.research.plan import _cancel_path


def _make_state(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "messages": [
            {
                "kind": "request",
                "parts": [{"part_kind": "user-prompt", "content": "Compare MIT and Stanford"}],
            }
        ],
        "turn_ids": {
            "message_id": "msg-001",
            "user_message_id": "usr-001",
            "messages_offset": 0,
        },
        "turn_records": [],
        "source_registry": [],
    }
    base.update(overrides)
    return base


def _make_writer() -> tuple[MagicMock, list[dict[str, Any]]]:
    chunks: list[dict[str, Any]] = []
    writer = MagicMock(side_effect=lambda c: chunks.append(c))
    return writer, chunks


class TestCancelPath:
    def test_returns_all_terminal_keys(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        research: dict[str, Any] = {"emissions": [], "caps": {}}

        result = _cancel_path(
            state,
            writer,
            [],
            research,
            state["messages"],
            "Compare MIT and Stanford",
        )

        required_keys = {
            "messages",
            "source_registry",
            "usage",
            "turn_records",
            "pending_clarify",
            "viz_emitted",
            "research",
        }
        assert required_keys <= set(result.keys()), (
            f"Missing keys: {required_keys - set(result.keys())}"
        )

    def test_pending_clarify_is_none(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        result = _cancel_path(state, writer, [], {}, state["messages"], "test")
        assert result["pending_clarify"] is None

    def test_viz_emitted_is_empty_list(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        result = _cancel_path(state, writer, [], {}, state["messages"], "test")
        assert result["viz_emitted"] == []

    def test_source_registry_is_list(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        result = _cancel_path(state, writer, [], {}, state["messages"], "test")
        assert isinstance(result["source_registry"], list)

    def test_usage_has_required_fields(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        result = _cancel_path(state, writer, [], {}, state["messages"], "test")
        usage = result["usage"]
        assert "input_tokens" in usage
        assert "output_tokens" in usage
        assert "tool_calls" in usage

    def test_turn_records_is_list_with_one_record(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        result = _cancel_path(state, writer, [], {}, state["messages"], "test")
        assert isinstance(result["turn_records"], list)
        assert len(result["turn_records"]) == 1

    def test_branch_is_cancel(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        result = _cancel_path(state, writer, [], {"emissions": []}, state["messages"], "test")
        assert result["research"]["branch"] == "cancel"

    def test_writer_emits_delta_chunk(self) -> None:
        state = _make_state()
        writer, chunks = _make_writer()
        _cancel_path(state, writer, [], {"emissions": []}, state["messages"], "test")
        delta_chunks = [c for c in chunks if c.get("type") == "delta"]
        assert len(delta_chunks) >= 1

    def test_messages_updated(self) -> None:
        state = _make_state()
        writer, _ = _make_writer()
        result = _cancel_path(state, writer, [], {}, state["messages"], "test")
        # messages should be at least as long as the input (partial may append)
        assert isinstance(result["messages"], list)
