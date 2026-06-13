"""Unit tests for the turn-record builder (B1b — app/records.py). Pure, no I/O.

The receipt format asserts byte-compatibility with the FE's ``deriveReceipt``
(wire-contract §7 — the pinned consumer contract); the parts builder asserts
the materialized-prose rule (G2: the record is self-contained).
"""

from __future__ import annotations

from typing import Any

import pytest

from app.records import (
    Emission,
    TurnStatus,
    append_or_replace,
    build_parts,
    build_turn_record,
    derive_receipt,
    prose_of,
)

# ---------------------------------------------------------------------------
# derive_receipt — the §7 contract table
# ---------------------------------------------------------------------------


def _step(step_id: str, kind: str, status: str = "end") -> dict[str, Any]:
    return {"step_id": step_id, "status": status, "kind": kind, "label": "x", "tier": None}


@pytest.mark.parametrize(
    ("kinds", "expected"),
    [
        ([], ""),
        (["db_tool"], "1 database lookup"),
        (["db_tool", "sql"], "2 database lookups"),
        (["web_search"], "1 web search"),
        (["web_search", "edu_search"], "2 web searches"),
        (["reddit_search"], "1 Reddit search"),
        (["reddit_search", "reddit_search"], "2 Reddit searches"),
        (["viz", "viz", "viz"], "3 visualizations"),
        (["skill"], "1 step"),
        (["research", "skill"], "2 steps"),
        (
            ["db_tool", "db_tool", "sql", "web_search", "viz"],
            "3 database lookups · 1 web search · 1 visualization",
        ),
        (
            ["db_tool", "web_search", "reddit_search", "viz", "skill"],
            "1 database lookup · 1 web search · 1 Reddit search · 1 visualization · 1 step",
        ),
    ],
)
def test_derive_receipt_table(kinds: list[str], expected: str) -> None:
    steps = [_step(f"s{i}", kind) for i, kind in enumerate(kinds)]
    assert derive_receipt(steps, []) == expected


def test_derive_receipt_empty_with_no_steps_and_no_thinking() -> None:
    assert derive_receipt([], []) == ""


def test_derive_receipt_thinking_only_still_has_no_step_segments() -> None:
    # Zero steps → no segments regardless of thinking (mirrors the FE exactly:
    # thinking only gates the early-return, never adds a segment).
    assert derive_receipt([], ["pondering"]) == ""


def test_derive_receipt_counts_one_per_step_id() -> None:
    # The counting unit is one step_id, regardless of how many terminal
    # events somehow share it.
    steps = [_step("s1", "db_tool"), _step("s1", "db_tool", status="error")]
    assert derive_receipt(steps, []) == "1 database lookup"


# ---------------------------------------------------------------------------
# build_parts — materialized prose, self-contained record (no offsets)
# ---------------------------------------------------------------------------


def test_parts_merge_adjacent_deltas() -> None:
    parts = build_parts([("delta", "Hello "), ("delta", "world")])
    assert parts == [{"type": "text", "text": "Hello world"}]


def test_parts_interleaved_text_viz_text() -> None:
    spec = {"type": "stat_block", "title": "Duke"}
    parts = build_parts(
        [("delta", "Before."), ("viz", spec), ("delta", " After"), ("delta", " end.")]
    )
    assert parts == [
        {"type": "text", "text": "Before."},
        {"type": "viz", "spec": spec},
        {"type": "text", "text": " After end."},
    ]


def test_parts_skip_empty_deltas_and_ignore_steps_thinking() -> None:
    parts = build_parts(
        [
            ("delta", ""),
            ("step", _step("s1", "db_tool")),
            ("delta", "Hi"),
            ("thinking", "hmm"),
            ("delta", ""),
            ("delta", "!"),
        ]
    )
    assert parts == [{"type": "text", "text": "Hi!"}]


def test_parts_viz_only_turn() -> None:
    spec = {"type": "score_band"}
    assert build_parts([("viz", spec)]) == [{"type": "viz", "spec": spec}]


# ---------------------------------------------------------------------------
# prose_of — the one source for "the assistant's text"
# ---------------------------------------------------------------------------


def test_prose_of_joins_text_parts_and_skips_viz() -> None:
    spec = {"type": "stat_block"}
    parts = build_parts([("delta", "Before."), ("viz", spec), ("delta", " After.")])
    assert prose_of(parts) == "Before. After."


def test_prose_of_empty_parts() -> None:
    assert prose_of([]) == ""
    assert prose_of([{"type": "viz", "spec": {}}]) == ""


# ---------------------------------------------------------------------------
# build_turn_record
# ---------------------------------------------------------------------------

_IDS = {"message_id": "m-1", "user_message_id": "u-1"}


def test_record_carries_ids_status_ts_offset_and_end_state_steps() -> None:
    emissions: list[Emission] = [
        ("step", _step("s1", "web_search", status="start")),
        ("thinking", "let me search"),
        ("step", _step("s1", "web_search", status="end")),
        ("delta", "Found it [1]."),
    ]
    record = build_turn_record(
        emissions,
        ids=_IDS,
        status="complete",
        sources=[{"index": 1}],
        user_text="any merit aid at duke?",
        usage={"input_tokens": 1, "output_tokens": 2, "tool_calls": 1},
        ts="2026-06-12T00:00:00+00:00",
        messages_offset=4,
    )
    assert record["message_id"] == "m-1"
    assert record["user_message_id"] == "u-1"
    assert record["user_text"] == "any merit aid at duke?"
    assert record["status"] == "complete"
    assert record["ts"] == "2026-06-12T00:00:00+00:00"
    assert record["messages_offset"] == 4
    # steps keep end-state events only — start frames are live-stream-only.
    assert [s["status"] for s in record["steps"]] == ["end"]
    assert record["thinking"] == ["let me search"]
    assert record["receipt"] == "1 web search"
    assert record["sources"] == [{"index": 1}]
    assert record["error"] is None
    assert record["clarify"] is None
    assert record["synthesized_answer"] is False
    assert record["parts"] == [{"type": "text", "text": "Found it [1]."}]
    assert prose_of(record["parts"]) == "Found it [1]."


def test_record_defaults_mint_ts_and_allow_no_usage_or_user_text() -> None:
    record = build_turn_record([], ids=_IDS, status="error", sources=[], messages_offset=0)
    assert record["usage"] is None
    assert record["user_text"] is None
    assert record["ts"]  # minted ISO timestamp
    assert record["receipt"] == ""


def test_status_literal_accepts_all_four_terminal_states() -> None:
    # TurnStatus is a typing.Literal — mypy catches typos at call sites; at
    # runtime all four sanctioned values build a record.
    statuses: tuple[TurnStatus, ...] = ("complete", "awaiting_input", "cancelled", "error")
    for status in statuses:
        record = build_turn_record([], ids=_IDS, status=status, sources=[], messages_offset=0)
        assert record["status"] == status


# ---------------------------------------------------------------------------
# append_or_replace — the overwrite-channel write rule
# ---------------------------------------------------------------------------


def _rec(message_id: str, status: str) -> dict[str, Any]:
    return {"message_id": message_id, "status": status}


def test_append_when_no_parked_record() -> None:
    prior = [_rec("m-1", "complete")]
    out = append_or_replace(prior, _rec("m-2", "complete"))
    assert [r["message_id"] for r in out] == ["m-1", "m-2"]
    assert prior == [_rec("m-1", "complete")]  # never mutated


def test_replace_parked_record_with_same_message_id() -> None:
    prior = [_rec("m-1", "complete"), _rec("m-2", "awaiting_input")]
    out = append_or_replace(prior, _rec("m-2", "complete"))
    assert [(r["message_id"], r["status"]) for r in out] == [
        ("m-1", "complete"),
        ("m-2", "complete"),
    ]


def test_no_replace_when_parked_id_differs() -> None:
    prior = [_rec("m-1", "awaiting_input")]
    out = append_or_replace(prior, _rec("m-2", "complete"))
    assert len(out) == 2
