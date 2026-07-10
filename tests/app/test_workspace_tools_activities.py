"""Honesty-critical formatter tests for the Activities workspace tool."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.workspace.agent_tools_activities import (
    _footer,
    honor_chars,
    render_activity_row,
    render_honor_row,
)
from app.workspace.models import Activity, Honor


def _activity(*, description: str, **changes: object) -> Activity:
    now = datetime.now(UTC)
    values: dict[str, object] = {
        "id": uuid4(),
        "user_id": uuid4(),
        "sort_order": 0,
        "activity_type": "Robotics",
        "position": "Captain",
        "organization": "Robotics Club",
        "description": description,
        "grades": ["10", "11"],
        "timing": ["school_year"],
        "created_at": now,
        "updated_at": now,
    }
    values.update(changes)
    return Activity.model_validate(values)


@pytest.mark.parametrize(
    ("length", "expected"),
    [
        (149, "desc 149/150"),
        (150, "desc 150/150"),
        (151, "desc 151/150 OVER"),
    ],
)
def test_activity_description_char_budget_is_exact_at_the_submission_boundary(
    length: int, expected: str
) -> None:
    row = render_activity_row(_activity(description="x" * length), rank=1)

    assert row["chars"].startswith("position 7/50 · org 13/100 · ")
    assert row["chars"].endswith(expected)
    assert (" OVER" in row["chars"]) is (length > 150)


def test_activity_character_budget_counts_astral_characters_once() -> None:
    row = render_activity_row(_activity(description="x" * 149 + "😀"), rank=1)

    assert row["chars"].endswith("desc 150/150")
    assert " OVER" not in row["chars"]


@pytest.mark.parametrize(
    ("field", "limit", "label"),
    [
        ("position", 50, "position"),
        ("organization", 100, "org"),
    ],
)
def test_activity_position_and_organization_budgets_mark_only_over_limit(
    field: str, limit: int, label: str
) -> None:
    within = render_activity_row(_activity(description="", **{field: "x" * limit}), rank=1)
    over = render_activity_row(_activity(description="", **{field: "x" * (limit + 1)}), rank=1)

    assert f"{label} {limit}/{limit}" in within["chars"]
    assert f"{label} {limit + 1}/{limit} OVER" in over["chars"]


def test_activity_row_preserves_raw_vocab_and_omits_empty_optional_values() -> None:
    row = render_activity_row(
        _activity(description="Built robots", story="", continue_in_college=False), rank=1
    )

    assert list(row) == [
        "rank",
        "id",
        "type",
        "position",
        "organization",
        "description",
        "grades",
        "timing",
        "continue",
        "chars",
    ]
    assert row["grades"] == ["10", "11"]
    assert row["timing"] == ["school_year"]
    assert "story" not in row


def test_archived_activity_row_has_no_rank_and_keeps_its_archive_date() -> None:
    archived_at = datetime(2026, 7, 9, tzinfo=UTC)
    row = render_activity_row(
        _activity(description="Built robots", archived_at=archived_at), state="archived"
    )

    assert "rank" not in row
    assert row["state"] == "archived"
    assert row["archived"] == "2026-07-09"


@pytest.mark.parametrize(
    ("length", "expected"),
    [(99, "title 99/100"), (100, "title 100/100"), (101, "title 101/100 OVER")],
)
def test_honor_title_budget_is_exact_and_marks_only_over_limit(length: int, expected: str) -> None:
    now = datetime.now(UTC)
    honor = Honor(
        id=uuid4(),
        user_id=uuid4(),
        sort_order=0,
        title="x" * length,
        grades=["11"],
        levels=["state_regional"],
        created_at=now,
        updated_at=now,
    )

    assert honor_chars(honor) == expected
    assert render_honor_row(honor, rank=1)["chars"] == expected


def test_archived_over_limit_entry_gets_an_explicit_trim_warning() -> None:
    archived = _activity(description="x" * 151)

    footer = _footer(
        status="archived",
        activities=[],
        honors=[],
        archived_activities=[archived],
        archived_honors=[],
    )

    assert "over the Common App character limit" in footer


@pytest.mark.parametrize("status", ["archived", "all"])
def test_archived_only_entries_keep_character_and_restore_guidance(status: str) -> None:
    footer = _footer(
        status=status,
        activities=[],
        honors=[],
        archived_activities=[_activity(description="Built robots")],
        archived_honors=[],
    )

    assert "Over-limit entries are flagged in chars and warrant a trim." in footer
    assert "restore_activity or restore_honor" in footer
