"""Unit tests for the StepMapper (app/steps.py) — labels, receipts, errors (B1a).

Table-driven against ``config/assets/step_labels.yaml``: one row per tool the
agent can call, plus exhaustiveness against the live tool surface (the MCP
server's registered names + the function tools), the no-unfilled-templates
net, and the receipts-never-carry-secrets house rule. No DB, no network.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic_ai.messages import RetryPromptPart

import counselle_db.server as db_server
from app.steps import StepMapper
from config.settings import load_yaml_asset

# The function tools mounted directly on the agent (app/toolset.py +
# app/agent_node.py). ask_student is deliberately NOT here — it is
# interrupt-backed and excluded from the timeline.
FUNCTION_TOOLS = {
    "search_web",
    "search_school_site",
    "search_reddit",
    "render_viz",
    "load_skill",
    "write_plan",
    "read_tool_result",
    "view_tasks",
    "search_tasks",
    "create_tasks",
    "update_task",
    "archive_tasks",
    "restore_task",
    "search_schools",
    "view_schools",
    "get_school",
    "add_schools",
    "update_school",
    "archive_schools",
    "restore_school",
    "view_essays",
    "read_essay",
    "create_essays",
    "update_essay",
    "duplicate_essay",
    "archive_essays",
    "restore_essay",
    "edit_essay",
    "write_essay",
    "view_activities",
    "create_activities",
    "update_activity",
    "archive_activities",
    "restore_activity",
    "reorder_activities",
    "create_honors",
    "update_honor",
    "archive_honors",
    "restore_honor",
    "reorder_honors",
    "update_profile",
    "view_documents",
    "read_document",
    "remember",
    "update_memory",
    "forget",
}

_SCHOOL_NAMES = {198419: "Duke University", 221999: "Vanderbilt University"}


def _resolve(unitid: int) -> str | None:
    return _SCHOOL_NAMES.get(unitid)


@pytest.fixture(scope="module")
def labels() -> dict[str, Any]:
    loaded = load_yaml_asset("step_labels")
    assert isinstance(loaded, dict)
    return loaded


@pytest.fixture(scope="module")
def mapper(labels: dict[str, Any]) -> StepMapper:
    return StepMapper(labels, _resolve)


# ---------------------------------------------------------------------------
# map_call: one row per tool in the asset
# ---------------------------------------------------------------------------

# (tool, representative args, expected kind, expected tier, label must contain)
_MAP_CALL_TABLE: list[tuple[str, dict[str, Any], str, str | None, list[str]]] = [
    ("resolve_school", {"query": "duke"}, "db_tool", "official", ["duke"]),
    (
        "get_values",
        {"unitid": 198419, "field_keys": ["admissions.acceptance_rate", "admissions.sat_25"]},
        "db_tool",
        "official",
        ["Duke University", "admissions"],
    ),
    ("get_dossier", {"unitid": 198419}, "db_tool", "official", ["Duke University"]),
    (
        "compare_schools",
        {"unitids": [198419, 221999], "field_keys": ["admissions.acceptance_rate"]},
        "db_tool",
        "official",
        ["Duke University", "Vanderbilt University"],
    ),
    ("find_schools", {"criteria": {"state": "NC"}}, "db_tool", "official", ["database"]),
    (
        "national_benchmark",
        {"field_key": "admissions.acceptance_rate"},
        "db_tool",
        "official",
        ["acceptance rate"],
    ),
    ("get_programs", {"unitid": 198419}, "db_tool", "official", ["Duke University"]),
    ("get_diversity", {"unitid": 198419}, "db_tool", "official", ["Duke University"]),
    ("get_data_calendar", {}, "db_tool", "official", ["fresh"]),
    ("search_fields", {"query": "early decision"}, "db_tool", "official", ["early decision"]),
    ("query_database", {"sql": "SELECT 1"}, "sql", "official", ["query"]),
    ("search_web", {"query": "duke dorms"}, "web_search", None, ["duke dorms"]),
    (
        "search_school_site",
        {"unitid": 198419, "query": "housing"},
        "edu_search",
        "official",
        ["Duke University", "housing"],
    ),
    (
        "search_reddit",
        {"query": "dorms", "subreddits": ["ApplyingToCollege"]},
        "reddit_search",
        "community",
        ["r/ApplyingToCollege"],
    ),
    (
        "render_viz",
        {"type": "comparison_table", "unitids": [198419, 221999]},
        "viz",
        None,
        ["comparison table"],
    ),
    ("load_skill", {"name": "essay-brainstorm"}, "skill", None, ["essay-brainstorm"]),
    (
        "write_plan",
        {"items": [{"content": "Compare schools", "status": "in_progress"}]},
        "write_plan",
        None,
        ["plan"],
    ),
    ("read_tool_result", {"handle": "tool-result-1"}, "db_tool", None, ["oversized"]),
    ("view_tasks", {}, "workspace", None, ["task list"]),
    (
        "search_tasks",
        {"query": "FAFSA"},
        "workspace",
        None,
        ["FAFSA"],
    ),
    (
        "create_tasks",
        {"tasks": [{"title": "Request transcript"}]},
        "workspace",
        None,
        ["a task"],
    ),
    ("update_task", {"task_id": "abc"}, "workspace", None, ["Updating a task"]),
    (
        "archive_tasks",
        {"task_ids": ["a", "b", "c"]},
        "workspace",
        None,
        ["3 tasks"],
    ),
    ("restore_task", {"task_id": "abc"}, "workspace", None, ["archived task"]),
    ("search_schools", {"query": "duke"}, "workspace", None, ["colleges"]),
    ("view_schools", {}, "workspace", None, ["school list"]),
    ("get_school", {"application_id": "abc"}, "workspace", None, ["inside a school"]),
    ("add_schools", {"schools": [{"unitid": 198419}]}, "workspace", None, ["Adding a school"]),
    ("update_school", {"application_id": "abc"}, "workspace", None, ["Updating a school"]),
    (
        "archive_schools",
        {"application_ids": ["a", "b"]},
        "workspace",
        None,
        ["Removing 2 schools"],
    ),
    ("restore_school", {"application_id": "abc"}, "workspace", None, ["removed school"]),
    ("view_essays", {}, "workspace", None, ["essay library"]),
    ("read_essay", {"essay_id": "abc"}, "workspace", None, ["Reading an essay"]),
    (
        "create_essays",
        {"essays": [{"title": "Common App essay"}]},
        "workspace",
        None,
        ["an essay"],
    ),
    ("update_essay", {"essay_id": "abc"}, "workspace", None, ["Updating an essay"]),
    ("duplicate_essay", {"essay_id": "abc"}, "workspace", None, ["Copying an essay"]),
    (
        "archive_essays",
        {"essay_ids": ["a", "b"]},
        "workspace",
        None,
        ["2 essays"],
    ),
    ("restore_essay", {"essay_id": "abc"}, "workspace", None, ["archived essay"]),
    ("edit_essay", {"essay_id": "abc"}, "workspace", None, ["Editing an essay"]),
    ("write_essay", {"essay_id": "abc"}, "workspace", None, ["Drafting an essay"]),
    ("view_activities", {}, "workspace", None, ["activities and honors"]),
    (
        "create_activities",
        {"activities": [{"type": "work", "position": "Cashier"}]},
        "workspace",
        None,
        ["an activity"],
    ),
    ("update_activity", {"activity_id": "abc"}, "workspace", None, ["Updating an activity"]),
    (
        "archive_activities",
        {"activity_ids": ["a", "b"]},
        "workspace",
        None,
        ["2 activities"],
    ),
    ("restore_activity", {"activity_id": "abc"}, "workspace", None, ["Bringing back"]),
    ("reorder_activities", {"ids": ["a", "b"]}, "workspace", None, ["Reordering"]),
    (
        "create_honors",
        {"honors": [{"title": "National Merit Scholar"}]},
        "workspace",
        None,
        ["an honor"],
    ),
    ("update_honor", {"honor_id": "abc"}, "workspace", None, ["Updating an honor"]),
    (
        "archive_honors",
        {"honor_ids": ["a", "b"]},
        "workspace",
        None,
        ["2 honors"],
    ),
    ("restore_honor", {"honor_id": "abc"}, "workspace", None, ["Bringing back"]),
    ("reorder_honors", {"ids": ["a", "b"]}, "workspace", None, ["Reordering"]),
    ("update_profile", {}, "workspace", None, ["Updating your profile"]),
    ("view_documents", {}, "workspace", None, ["Checking your documents"]),
    ("read_document", {"document_ref": "abc12345"}, "workspace", None, ["Reading a document"]),
    ("remember", {"notes": ["prefers blunt feedback"]}, "memory", None, ["Remembering"]),
    ("update_memory", {"memory_ref": "abc12345"}, "memory", None, ["Updating a memory"]),
    (
        "forget",
        {"memory_refs": ["abc12345", "def67890"]},
        "memory",
        None,
        ["Forgetting 2 notes"],
    ),
]


@pytest.mark.parametrize(
    ("tool", "args", "kind", "tier", "contains"),
    _MAP_CALL_TABLE,
    ids=[row[0] for row in _MAP_CALL_TABLE],
)
def test_map_call_kind_tier_and_label(
    mapper: StepMapper,
    tool: str,
    args: dict[str, Any],
    kind: str,
    tier: str | None,
    contains: list[str],
) -> None:
    mapped = mapper.map_call(tool, args)

    assert mapped.kind == kind
    assert mapped.tier == tier
    for needle in contains:
        assert needle in mapped.label, f"{tool}: {needle!r} not in {mapped.label!r}"
    assert "{" not in mapped.label and "}" not in mapped.label


def test_map_call_table_covers_every_yaml_row(labels: dict[str, Any]) -> None:
    """The parametrized table above exercises every tool row in the asset."""
    assert {row[0] for row in _MAP_CALL_TABLE} == set(labels["tools"])


# ---------------------------------------------------------------------------
# Exhaustiveness against the live tool surface
# ---------------------------------------------------------------------------


def test_yaml_covers_every_agent_tool(labels: dict[str, Any]) -> None:
    """Every tool the agent can call has a label row — no step ever falls to
    the generic default in production (the asset and the surface move together)."""
    mcp_tools = {tool.name for tool in db_server.mcp._tool_manager.list_tools()}
    assert mcp_tools, "MCP tool registry introspection returned nothing"

    surface = mcp_tools | FUNCTION_TOOLS
    missing = surface - set(labels["tools"])
    assert not missing, f"tools with no step_labels row: {sorted(missing)}"


def test_ask_student_is_not_in_the_asset(labels: dict[str, Any]) -> None:
    """ask_student is interrupt-backed: excluded from the timeline, so no row."""
    assert "ask_student" not in labels["tools"]


def test_unknown_tool_maps_to_default_row_without_braces(mapper: StepMapper) -> None:
    mapped = mapper.map_call("some_future_tool", {})

    assert mapped.kind == "db_tool"
    assert "some_future_tool" in mapped.label
    assert "{" not in mapped.label and "}" not in mapped.label


def test_kind_for_known_and_unknown(mapper: StepMapper) -> None:
    """_kind_for is the single owner of the unknown ⇒ db_tool default (audit L5).

    A known tool resolves to its asset kind; an unknown one falls to db_tool —
    identical to what map_call/detail_for/sources_for derive for the kind."""
    known = next(row[0] for row in _MAP_CALL_TABLE)
    expected = next(row[2] for row in _MAP_CALL_TABLE)
    assert mapper._kind_for(known) == expected
    assert mapper._kind_for("some_future_tool") == "db_tool"
    # Equivalence with map_call's kind for the same unknown tool.
    assert mapper._kind_for("some_future_tool") == mapper.map_call("some_future_tool", {}).kind


# ---------------------------------------------------------------------------
# No unfilled templates: empty args never leak `{key}` to the student
# ---------------------------------------------------------------------------


def test_every_row_with_empty_args_has_no_braces(
    labels: dict[str, Any], mapper: StepMapper
) -> None:
    for tool in [*labels["tools"], "totally_unknown_tool"]:
        label = mapper.map_call(tool, {}).label
        assert "{" not in label and "}" not in label, f"{tool}: unfilled template {label!r}"


# ---------------------------------------------------------------------------
# error_label: the three failure classes
# ---------------------------------------------------------------------------


def test_error_label_retry_class(mapper: StepMapper) -> None:
    mapped = mapper.map_call("get_values", {"unitid": 198419})

    label = mapper.error_label(mapped, retry=True)

    assert label == f"{mapped.label} — the request needed a correction"


def test_error_label_search_failed_class(mapper: StepMapper) -> None:
    for tool in ("search_web", "search_school_site", "search_reddit"):
        mapped = mapper.map_call(tool, {"query": "dorms"})

        label = mapper.error_label(mapped, retry=False)

        assert label == f"{mapped.label} — source unavailable"


def test_error_label_tool_failed_class(mapper: StepMapper) -> None:
    for tool in ("get_values", "query_database", "render_viz", "load_skill"):
        mapped = mapper.map_call(tool, {})

        label = mapper.error_label(mapped, retry=False)

        assert label == f"{mapped.label} — failed"


# ---------------------------------------------------------------------------
# result_is_error: result-shape detection
# ---------------------------------------------------------------------------


def test_result_is_error_retry_prompt_part() -> None:
    part = RetryPromptPart(content="bad args", tool_name="get_values", tool_call_id="c1")

    assert StepMapper.result_is_error(part, None) is True


def test_result_is_error_error_dict() -> None:
    assert StepMapper.result_is_error(object(), {"error": "rate limited"}) is True


def test_result_is_error_normal_shapes_are_fine() -> None:
    assert StepMapper.result_is_error(object(), {"results": []}) is False
    assert StepMapper.result_is_error(object(), [{"value": 1}]) is False
    assert StepMapper.result_is_error(object(), None) is False


# ---------------------------------------------------------------------------
# detail_for: the expandable receipts
# ---------------------------------------------------------------------------


def test_detail_for_search_kind_counts_and_domains(mapper: StepMapper) -> None:
    content = {
        "results": [
            {"url": "https://www.niche.com/x"},
            {"url": "https://reddit.com/y"},
            {"url": "https://www.niche.com/z"},  # dupe domain — deduped
        ]
    }

    detail = mapper.detail_for("search_web", {"query": "duke dorms"}, content, 120)

    assert detail.query == "duke dorms"
    assert detail.result_count == 3
    assert detail.domains == ["niche.com", "reddit.com"]
    assert detail.duration_ms == 120


def test_search_success_without_results_list_shows_zero(mapper: StepMapper) -> None:
    # BC-13: a search that succeeds with a dict carrying no `results` list (shape
    # drift) must show "0 results" explicitly, not omit the count.
    detail = mapper.detail_for("search_web", {"query": "x"}, {"query": "x"}, 30)

    assert detail.result_count == 0


def test_detail_for_overflowed_search_uses_public_receipt(mapper: StepMapper) -> None:
    content = {
        "status": "overflow",
        "public_receipt": {
            "result_count": 2,
            "domains": ["duke.edu", "admissions.duke.edu"],
            "source_results": [
                {"url": "https://duke.edu/a", "title": "Duke"},
                {"url": "https://admissions.duke.edu/b", "title": "Admissions"},
            ],
        },
    }

    detail = mapper.detail_for("search_school_site", {"query": "cs admissions"}, content, 30)

    assert detail.result_count == 2
    assert detail.domains == ["duke.edu", "admissions.duke.edu"]


def test_detail_for_errored_search_omits_result_count(mapper: StepMapper) -> None:
    # BC-13 regression: an errored search dict still omits the count (no green
    # "0 results" — the step is status:error and carries no count).
    detail = mapper.detail_for("search_web", {"query": "x"}, {"error": "rate limited"}, 30)

    assert detail.result_count is None


def test_detail_for_normal_search_still_counts_results(mapper: StepMapper) -> None:
    # BC-13 regression: a normal results list is still counted by length.
    content = {"results": [{"url": "https://a.com/x"}, {"url": "https://b.com/y"}]}

    detail = mapper.detail_for("search_web", {"query": "x"}, content, 30)

    assert detail.result_count == 2


def test_sources_for_overflowed_search_use_public_receipt(mapper: StepMapper) -> None:
    content = {
        "status": "overflow",
        "public_receipt": {
            "source_results": [
                {"url": "https://duke.edu/a", "title": "Duke"},
                {"url": "https://admissions.duke.edu/b", "title": "Admissions"},
            ],
        },
    }

    sources = mapper.sources_for("search_school_site", {"query": "cs admissions"}, content)

    assert sources is not None
    assert [source.label for source in sources] == ["duke.edu", "admissions.duke.edu"]


def test_detail_for_sql_kind_carries_statement_and_row_count(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "query_database",
        {"sql": "SELECT unitid FROM schools WHERE state = $1"},
        {"rows": [[1], [2], [3]]},
        45,
    )

    assert detail.query == "SELECT unitid FROM schools WHERE state = $1"
    assert detail.row_count == 3
    assert detail.tool == "query_database"


def test_detail_for_db_tool_kind(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "get_values",
        {"unitid": 198419, "field_keys": ["admissions.acceptance_rate", "admissions.sat_25"]},
        [{"field": "a"}, {"field": "b"}],
        80,
    )

    assert detail.tool == "get_values"
    assert detail.field_keys == ["admissions.acceptance_rate", "admissions.sat_25"]
    assert detail.row_count == 2
    assert detail.value_count == 2
    assert detail.schools == ["Duke University"]


def test_detail_for_viz_kind(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "render_viz",
        {"type": "comparison_table", "unitids": [221999]},
        {"ok": True, "public_receipt": {"value_count": 3}},
        10,
    )

    assert detail.viz_type == "comparison_table"
    assert detail.schools == ["Vanderbilt University"]
    assert detail.value_count == 3


def test_detail_for_write_plan_kind(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "write_plan",
        {"items": [{"content": "Compare schools", "status": "in_progress"}]},
        {
            "status": "success",
            "public_receipt": {
                "items": [
                    {"content": "Resolve schools", "status": "completed"},
                    {"content": "Compare costs", "status": "in_progress"},
                ],
                "completed": 1,
                "total": 2,
            },
        },
        12,
    )

    assert detail.items == [
        {"content": "Resolve schools", "status": "completed"},
        {"content": "Compare costs", "status": "in_progress"},
    ]
    assert detail.completed == 1
    assert detail.total == 2
    assert detail.duration_ms == 12


def test_detail_for_workspace_kind_carries_summary(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "create_tasks",
        {"tasks": [{"title": "Request transcript"}]},
        {"status": "ok", "summary": "Created 1 task.", "created": [{"id": "1", "title": "x"}]},
        20,
    )

    assert detail.summary == "Created 1 task."
    assert detail.duration_ms == 20


def test_detail_for_workspace_kind_error_path(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "update_task",
        {"task_id": "stale"},
        {
            "status": "error",
            "error": 'No active task with id "stale".',
            "safe_retry": "Call view_tasks to see current active tasks.",
        },
        8,
    )

    assert detail.error == 'No active task with id "stale".'
    assert detail.next_actions == ["Call view_tasks to see current active tasks."]


def test_workspace_label_tasks_phrase_singular_and_plural(mapper: StepMapper) -> None:
    singular = mapper.map_call("create_tasks", {"tasks": [{"title": "Request transcript"}]})
    plural = mapper.map_call(
        "create_tasks", {"tasks": [{"title": "a"}, {"title": "b"}, {"title": "c"}]}
    )

    assert singular.label == "Adding a task to the plan"
    assert plural.label == "Adding 3 tasks to the plan"

    archive_singular = mapper.map_call("archive_tasks", {"task_ids": ["a"]})
    archive_plural = mapper.map_call("archive_tasks", {"task_ids": ["a", "b"]})

    assert archive_singular.label == "Archiving a task"
    assert archive_plural.label == "Archiving 2 tasks"


def test_receipts_never_carry_secrets(mapper: StepMapper, labels: dict[str, Any]) -> None:
    """Every kind's receipt, built from realistic args AND a content payload that
    deliberately contains secret-shaped junk, must serialize none of it."""
    poisoned_content = {
        "results": [{"url": "https://www.niche.com/x"}],
        "rows": [[1]],
        "dsn": "postgresql://counselle_ro:password@localhost:5432/pipeline",
        "api_key": "tvly-dev-abcdef1234567890",
        "password": "hunter2",
    }
    forbidden = ("postgresql://", "dsn", "password", "api_key", "tvly-")
    for tool, args, _kind, _tier, _contains in _MAP_CALL_TABLE:
        detail = mapper.detail_for(tool, args, poisoned_content, 5)

        serialized = json.dumps(detail.model_dump())
        for needle in forbidden:
            assert needle not in serialized, f"{tool}: receipt leaked {needle!r}: {serialized}"


def test_receipts_never_carry_error_message_dsn(mapper: StepMapper) -> None:
    """An ``{"error": …}`` result whose message embeds a DSN must not reach any
    detail field — error text is for labels (via error_label), never receipts."""
    error_content = {"error": "postgresql://counselle_ro:secret@localhost/pipeline"}
    for tool, args, _kind, _tier, _contains in _MAP_CALL_TABLE:
        detail = mapper.detail_for(tool, args, error_content, 5)

        serialized = json.dumps(detail.model_dump())
        for needle in ("postgresql://", "counselle_ro", "secret"):
            assert needle not in serialized, f"{tool}: receipt leaked {needle!r}: {serialized}"


def test_error_receipt_carries_safe_recovery_detail(mapper: StepMapper) -> None:
    detail = mapper.detail_for(
        "query_database",
        {"sql": "SELECT * FROM missing_table"},
        {
            "error": "tool_error",
            "root_cause": "relation missing_table does not exist",
            "safe_retry": "Search fields first, then retry with a valid table.",
            "stop_condition": "If no valid table exists, say the data is unavailable.",
        },
        5,
    )

    assert detail.error == "relation missing_table does not exist"
    assert detail.next_actions == [
        "Search fields first, then retry with a valid table.",
        "If no valid table exists, say the data is unavailable.",
    ]
