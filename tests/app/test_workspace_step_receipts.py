"""Privacy and overflow regressions for public workspace read previews."""

from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from app.tool_overflow import ToolResultStore


def test_workspace_preview_allowlists_display_metadata_only() -> None:
    result = process_tool_result(
        {
            "status": "ok",
            "summary": "1 active task.",
            "tasks": [
                {
                    "id": "private-id",
                    "title": "Submit FAFSA",
                    "status": "doing",
                    "due": "2026-01-31",
                    "category": "financial_aid",
                    "notes": "private counselor notes",
                    "match": "private search excerpt",
                }
            ],
        },
        ToolMiddlewareContext(),
        tool_name="view_tasks",
    )

    receipt = result["public_receipt"]
    assert receipt["result_count"] == 1
    assert receipt["workspace_items"] == [
        {
            "kind": "task",
            "title": "Submit FAFSA",
            "meta": [
                {"label": "Due", "value": "2026-01-31"},
                {"label": "Category", "value": "financial_aid"},
            ],
            "status": "doing",
            "group": None,
        }
    ]
    assert "private-id" not in str(receipt)
    assert "private counselor notes" not in str(receipt)
    assert "private search excerpt" not in str(receipt)


def test_oversized_workspace_result_keeps_safe_preview() -> None:
    result = process_tool_result(
        {
            "status": "ok",
            "summary": "30 essays.",
            "result_count": 30,
            "essays": [
                {
                    "id": "private-id",
                    "title": "Stanford personal statement",
                    "school": "Stanford University",
                    "words": "612/650",
                    "preview": "private essay text " * 100,
                }
            ],
        },
        ToolMiddlewareContext(overflow_store=ToolResultStore(), max_result_chars=200),
        tool_name="view_essays",
    )

    assert result["status"] == "overflow"
    receipt = result["public_receipt"]
    assert receipt["summary"] == "30 essays."
    assert receipt["result_count"] == 30
    assert receipt["workspace_items"][0]["title"] == "Stanford personal statement"
    assert "private essay text" not in str(receipt)
