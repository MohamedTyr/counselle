"""Contract invariants for the mutation-receipt envelope (plan §6, §16.1)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from domain.mutation_receipts import (
    BatchMutationBody,
    BoundedDisplayText,
    ItemDisposition,
    MemoryMutationBody,
    MutationChange,
    MutationItem,
    MutationSubject,
    MutationValue,
    UnresolvedMutationBody,
    UpdateMutationBody,
    WorkspaceMutationReceipt,
)


def _subject(title: str = "Submit FAFSA") -> MutationSubject:
    return MutationSubject(title=BoundedDisplayText(text=title))


def _item(index: int, disposition: ItemDisposition) -> MutationItem:
    return MutationItem(input_index=index, disposition=disposition, subject=_subject())


class TestBoundedDisplayText:
    def test_untruncated_forbids_original_graphemes(self) -> None:
        with pytest.raises(ValidationError):
            BoundedDisplayText(text="hi", truncated=False, original_graphemes=5)

    def test_truncated_requires_larger_original(self) -> None:
        with pytest.raises(ValidationError):
            BoundedDisplayText(text="hi", truncated=True, original_graphemes=2)

    def test_truncated_accepts_larger_original(self) -> None:
        text = BoundedDisplayText(text="hi", truncated=True, original_graphemes=10)
        assert text.truncated is True


class TestMutationValue:
    def test_kind_requires_matching_payload(self) -> None:
        with pytest.raises(ValidationError):
            MutationValue(kind="text")  # missing `text`

    def test_kind_with_payload_is_valid(self) -> None:
        value = MutationValue(kind="boolean", boolean=True)
        assert value.boolean is True


class TestMutationChange:
    def test_set_requires_after(self) -> None:
        with pytest.raises(ValidationError):
            MutationChange(field_key="title", operation="set")

    def test_clear_forbids_values(self) -> None:
        with pytest.raises(ValidationError):
            MutationChange(
                field_key="notes",
                operation="clear",
                after=MutationValue(kind="boolean", boolean=True),
            )

    def test_state_only_forbids_values(self) -> None:
        with pytest.raises(ValidationError):
            MutationChange(
                field_key="notes",
                operation="state_only",
                after=MutationValue(kind="boolean", boolean=True),
            )

    def test_move_requires_before_and_after(self) -> None:
        with pytest.raises(ValidationError):
            MutationChange(field_key="rank", operation="move")


class TestBatchMutationBody:
    def test_requires_contiguous_unique_indices(self) -> None:
        with pytest.raises(ValidationError):
            BatchMutationBody(items=(_item(0, "changed"), _item(2, "changed")))

    def test_accepts_contiguous_indices(self) -> None:
        body = BatchMutationBody(items=(_item(0, "changed"), _item(1, "skipped")))
        assert body.changed_count == 1
        assert body.total_count == 2

    def test_repeated_input_ids_are_separate_positions(self) -> None:
        # Same subject twice — a duplicate input id remains a distinct position.
        body = BatchMutationBody(
            items=(
                MutationItem(input_index=0, disposition="changed", subject=_subject("Same")),
                MutationItem(
                    input_index=1,
                    disposition="skipped",
                    subject=_subject("Same"),
                    reason=BoundedDisplayText(text="duplicate input"),
                ),
            )
        )
        assert body.total_count == 2


class TestWorkspaceMutationReceiptFamilyActionBody:
    def test_valid_pair_and_body_accepted(self) -> None:
        receipt = WorkspaceMutationReceipt(
            family="task",
            action="update",
            outcome="success",
            body=UpdateMutationBody(
                subject=_subject(),
                changes=(
                    MutationChange(
                        field_key="status",
                        operation="set",
                        after=MutationValue(kind="enum", enum="doing"),
                    ),
                ),
            ),
        )
        assert receipt.v == 1

    def test_invalid_family_action_pair_rejected(self) -> None:
        with pytest.raises(ValidationError):
            WorkspaceMutationReceipt(
                family="task",
                action="forget",
                outcome="success",
                body=UpdateMutationBody(
                    subject=_subject(),
                    changes=(
                        MutationChange(
                            field_key="status",
                            operation="set",
                            after=MutationValue(kind="enum", enum="doing"),
                        ),
                    ),
                ),
            )

    def test_wrong_body_kind_for_valid_pair_rejected(self) -> None:
        with pytest.raises(ValidationError):
            WorkspaceMutationReceipt(
                family="activity",
                action="reorder",
                outcome="success",
                body=UpdateMutationBody(
                    subject=_subject(),
                    changes=(
                        MutationChange(
                            field_key="rank",
                            operation="set",
                            after=MutationValue(kind="integer", integer=1),
                        ),
                    ),
                ),
            )

    def test_unknown_outcome_requires_unresolved_body(self) -> None:
        with pytest.raises(ValidationError):
            WorkspaceMutationReceipt(
                family="task",
                action="update",
                outcome="unknown",
                body=UpdateMutationBody(
                    subject=_subject(),
                    changes=(
                        MutationChange(
                            field_key="status",
                            operation="set",
                            after=MutationValue(kind="enum", enum="doing"),
                        ),
                    ),
                ),
            )

    def test_unresolved_body_valid_for_failed_and_unknown_only(self) -> None:
        for outcome in ("failed", "unknown"):
            receipt = WorkspaceMutationReceipt(
                family="task",
                action="create",
                outcome=outcome,
                body=UnresolvedMutationBody(family="task", verification="task_list"),
            )
            assert receipt.outcome == outcome
        with pytest.raises(ValidationError):
            WorkspaceMutationReceipt(
                family="task",
                action="create",
                outcome="success",
                body=UnresolvedMutationBody(family="task", verification="task_list"),
            )


class TestMemoryMutationBody:
    def test_forget_forbids_content(self) -> None:
        with pytest.raises(ValidationError):
            MemoryMutationBody(
                operation="forget",
                note_count=1,
                active_notes=(BoundedDisplayText(text="leaked"),),
            )

    def test_remember_requires_content(self) -> None:
        with pytest.raises(ValidationError):
            MemoryMutationBody(operation="remember", note_count=1, active_notes=())

    def test_active_notes_length_matches_count(self) -> None:
        with pytest.raises(ValidationError):
            MemoryMutationBody(
                operation="remember", note_count=2, active_notes=(BoundedDisplayText(text="one"),)
            )


class TestDuplicateBodyWireShape:
    def test_copy_alias_round_trips(self) -> None:
        from domain.mutation_receipts import DuplicateMutationBody

        body = DuplicateMutationBody.model_validate(
            {"source": _subject("Original"), "copy": _subject("Copy")}
        )
        dumped = body.model_dump(mode="json", by_alias=True)
        assert "copy" in dumped
        assert "copy_subject" not in dumped
        restored = DuplicateMutationBody.model_validate(dumped)
        assert restored.copy_subject.title.text == "Copy"
