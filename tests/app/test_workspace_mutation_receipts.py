"""Builder-level tests for the mutation-receipt contract (plan §6.6, §7.4)."""

from __future__ import annotations

import pytest
from pydantic_core import to_json

from app.tool_overflow import ToolResultStore, reduce_tool_result
from app.workspace_mutation_receipts import (
    RECEIPT_MAX_BYTES,
    WRITE_TOOL_FAMILY_ACTION,
    attach_mutation,
    batch_item,
    batch_receipt,
    bounded_display_text,
    count_graphemes,
    outcome_for_batch,
    subject,
    truncate_graphemes,
    unresolved_receipt,
    update_receipt,
)
from domain.mutation_receipts import (
    ItemDisposition,
    MutationChange,
    MutationItem,
    MutationValue,
    UpdateMutationBody,
    WorkspaceMutationReceipt,
)


class TestGraphemeTruncation:
    def test_short_text_untouched(self) -> None:
        text, truncated, original = truncate_graphemes("hello", 240)
        assert text == "hello"
        assert truncated is False
        assert original is None

    def test_long_text_truncated_with_original_count(self) -> None:
        long_text = "a" * 300
        text, truncated, original = truncate_graphemes(long_text, 240)
        assert len(text) == 240
        assert truncated is True
        assert original == 300

    def test_combining_marks_count_as_one_grapheme(self) -> None:
        # "e" + combining acute accent is one visible character, two code points.
        combined = "é"
        assert count_graphemes(combined) == 1
        assert len(combined) == 2

    def test_bounded_display_text_builder_matches_truncate_graphemes(self) -> None:
        long_text = "b" * 500
        built = bounded_display_text(long_text, max_graphemes=240)
        assert built.truncated is True
        assert built.original_graphemes == 500
        assert len(built.text) == 240


class TestOutcomeForBatch:
    def _items(self, dispositions: list[ItemDisposition]) -> list[MutationItem]:
        return [
            batch_item(i, d, item_subject=subject(f"Item {i}") if d == "changed" else None)
            for i, d in enumerate(dispositions)
        ]

    def test_all_changed_is_success(self) -> None:
        assert outcome_for_batch(self._items(["changed", "changed"])) == "success"

    def test_mixed_changed_and_skipped_is_partial(self) -> None:
        assert outcome_for_batch(self._items(["changed", "skipped"])) == "partial"

    def test_all_unchanged_is_no_change(self) -> None:
        assert outcome_for_batch(self._items(["unchanged", "unchanged"])) == "no_change"

    def test_all_failed_is_failed(self) -> None:
        assert outcome_for_batch(self._items(["failed", "failed"])) == "failed"

    def test_any_unknown_is_unknown(self) -> None:
        assert outcome_for_batch(self._items(["changed", "unknown"])) == "unknown"


class TestAttachMutation:
    def test_attaches_marker_and_merges_existing_receipt(self) -> None:
        item = batch_item(0, "changed", item_subject=subject("X"))
        receipt = batch_receipt(family="task", action="create", items=[item])
        payload = {
            "status": "ok",
            "public_receipt": {"ui": {"widget": "task_added", "data": {}}},
        }
        out = attach_mutation(payload, receipt)
        assert out["mutation_contract"] == 1
        assert out["public_receipt"]["ui"] == {"widget": "task_added", "data": {}}
        assert out["public_receipt"]["mutation"]["family"] == "task"

    def test_update_receipt_reduces_tail_changes_to_fit_budget(self) -> None:
        # 20 near-max-length changes would exceed RECEIPT_MAX_BYTES; the
        # builder must reduce tail changes (§6.6) rather than ship oversized.
        changes = [
            MutationChange(
                field_key="notes",
                operation="set",
                after=MutationValue(kind="text", text=bounded_display_text("x" * 240)),
            )
            for _ in range(20)
        ]
        receipt = update_receipt(
            family="task", action="update", update_subject=subject("Task"), changes=changes
        )
        assert isinstance(receipt.body, UpdateMutationBody)
        assert len(receipt.body.changes) < 20
        assert receipt.omissions.changes == 20 - len(receipt.body.changes)
        payload = attach_mutation({}, receipt)
        assert len(to_json(payload["public_receipt"]["mutation"])) <= RECEIPT_MAX_BYTES


class TestUnresolvedReceipt:
    def test_covers_all_29_tools(self) -> None:
        assert len(WRITE_TOOL_FAMILY_ACTION) == 29

    @pytest.mark.parametrize("tool_name", sorted(WRITE_TOOL_FAMILY_ACTION))
    def test_every_registered_tool_builds_a_valid_unresolved_receipt(self, tool_name: str) -> None:
        family, action = WRITE_TOOL_FAMILY_ACTION[tool_name]
        for outcome in ("failed", "unknown"):
            receipt = unresolved_receipt(family=family, action=action, outcome=outcome)
            assert receipt.body.kind == "unresolved"
            assert receipt.outcome == outcome


def _created_task_receipt() -> WorkspaceMutationReceipt:
    item = batch_item(0, "changed", item_subject=subject("X"))
    return batch_receipt(family="task", action="create", items=[item])


class TestOverflowPreservesMutation:
    def test_mutation_survives_overflow_reduction(self) -> None:
        base_payload = {
            "status": "ok",
            "summary": "x" * 5_000,
            "created": [{"id": "1", "title": "X"}],
        }
        payload = attach_mutation(base_payload, _created_task_receipt())
        store = ToolResultStore()
        reduced = reduce_tool_result(payload, store, max_chars=200)
        assert reduced["status"] == "overflow"
        assert reduced["mutation_contract"] == 1
        assert reduced["public_receipt"]["mutation"]["family"] == "task"

    def test_compact_result_stays_under_budget_even_with_low_max_chars(self) -> None:
        base_payload = {
            "status": "ok",
            "summary": "y" * 50_000,
            "created": [{"id": "1", "title": "X"}],
        }
        payload = attach_mutation(base_payload, _created_task_receipt())
        store = ToolResultStore()
        reduced = reduce_tool_result(payload, store, max_chars=300)
        assert len(to_json(reduced)) <= 10_240
        assert reduced["public_receipt"]["mutation"]["family"] == "task"
