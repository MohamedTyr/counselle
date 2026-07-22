"""Unit tests for Phase 3's clarification acceptance lifecycle (app/clarify_lifecycle.py).

No DB, no LLM: a minimal fake graph duck-types the two calls
``accept_clarification`` makes (``aget_state``/``aupdate_state``). These tests
are the "high-value regression matrix" items this module owns: stale/
duplicate/malformed/mismatched requests leave state untouched; a successful
accept is one atomic write; the claim registry serializes a racing
accept/cancel.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.clarify_lifecycle import (
    ClarificationConflict,
    ClarifyClaimBusy,
    ClarifyClaimRegistry,
    ClarifyRequestKind,
    OperationPhase,
    accept_clarification,
    classify_clarify_request,
)
from domain.clarification import ContinuationIntent


class _Snapshot:
    def __init__(self, values: dict[str, Any]) -> None:
        self.values = values


class FakeGraph:
    """Duck-types the two ``graph`` calls the acceptance path makes."""

    def __init__(self, values: dict[str, Any]) -> None:
        self.values = values
        self.updates: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
        self.fail_update = False

    async def aget_state(self, config: dict[str, Any]) -> _Snapshot:
        return _Snapshot(dict(self.values))

    async def aupdate_state(
        self, config: dict[str, Any], update: dict[str, Any], as_node: str | None = None
    ) -> None:
        if self.fail_update:
            raise RuntimeError("boom")
        self.updates.append((update, {"as_node": as_node}))
        self.values.update(update)


_SPEC_V2 = {
    "v": 2,
    "questions": [
        {
            "id": "q1",
            "question": "Which term?",
            "selection": "single",
            "options": [
                {"id": "q1_o1", "label": "Fall", "hint": None},
                {"id": "q1_o2", "label": "Spring", "hint": None},
            ],
        }
    ],
}


def _pending_values(**overrides: Any) -> dict[str, Any]:
    record = {
        "message_id": "a1-msg",
        "user_message_id": "u1-msg",
        "status": "awaiting_input",
        "skills": ["financial_aid"],
        "clarify": {"spec": _SPEC_V2, "response": None},
        **overrides,
    }
    return {
        "turn_records": [record],
        "messages": [{"kind": "request"}, {"kind": "response"}],
        "source_config": {"web": True, "reddit": False, "edu": True},
    }


# ---------------------------------------------------------------------------
# classify_clarify_request
# ---------------------------------------------------------------------------


def test_classify_structured_body_is_always_widget_answer() -> None:
    kind = classify_clarify_request(
        clarify_response={"mode": "widget"},
        text=None,
        has_pending_v2=True,
        has_pending_legacy=False,
    )
    assert kind is ClarifyRequestKind.WIDGET_ANSWER


def test_classify_text_with_pending_v2_is_composer_answer() -> None:
    kind = classify_clarify_request(
        clarify_response=None, text="Fall 2027", has_pending_v2=True, has_pending_legacy=False
    )
    assert kind is ClarifyRequestKind.COMPOSER_ANSWER


def test_classify_text_with_only_pending_legacy_is_legacy_answer() -> None:
    kind = classify_clarify_request(
        clarify_response=None, text="Fall 2027", has_pending_v2=False, has_pending_legacy=True
    )
    assert kind is ClarifyRequestKind.LEGACY_ANSWER


def test_classify_plain_text_with_no_pending_is_normal() -> None:
    kind = classify_clarify_request(
        clarify_response=None, text="hi", has_pending_v2=False, has_pending_legacy=False
    )
    assert kind is ClarifyRequestKind.NORMAL


# ---------------------------------------------------------------------------
# accept_clarification — happy paths
# ---------------------------------------------------------------------------


async def test_accept_widget_response_updates_a1_and_prepares_a2() -> None:
    graph = FakeGraph(_pending_values())
    prepared = await accept_clarification(
        graph,
        "sess-1",
        in_reply_to="a1-msg",
        widget_response_payload={
            "mode": "widget",
            "answers": [{"question_id": "q1", "option_ids": ["q1_o1"]}],
        },
    )
    assert prepared.origin == "widget"
    assert prepared.project_user is False
    assert prepared.record_user_text is None
    assert prepared.root_message_id == "a1-msg"
    assert prepared.inherited_skills == ("financial_aid",)
    assert prepared.inherited_source_config == {"web": True, "reddit": False, "edu": True}
    assert "Fall" in prepared.model_input_text

    (update, kwargs), = graph.updates
    assert kwargs is not None and kwargs["as_node"] == "agent"
    updated_record = update["turn_records"][-1]
    assert updated_record["status"] == "complete"
    assert updated_record["clarify"]["response"]["mode"] == "widget"
    intent = ContinuationIntent.model_validate(update["continuation_intent"])
    assert intent.phase == "accepted"
    assert intent.root_message_id == "a1-msg"
    assert intent.continuation_message_id == prepared.continuation_message_id


async def test_accept_composer_reply_projects_exact_text_and_user_id() -> None:
    graph = FakeGraph(_pending_values())
    prepared = await accept_clarification(
        graph, "sess-1", in_reply_to="a1-msg", composer_text="Let's go with Fall."
    )
    assert prepared.origin == "reply"
    assert prepared.project_user is True
    assert prepared.record_user_text == "Let's go with Fall."
    assert prepared.model_input_text == "Let's go with Fall."
    assert prepared.user_message_id is not None


# ---------------------------------------------------------------------------
# accept_clarification — every failure path leaves state untouched
# ---------------------------------------------------------------------------


async def test_accept_rejects_when_nothing_is_pending() -> None:
    graph = FakeGraph({"turn_records": [], "messages": []})
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph,
            "sess-1",
            in_reply_to=None,
            widget_response_payload={"mode": "widget", "answers": []},
        )
    assert exc.value.code == "clarification_stale"
    assert graph.updates == []


async def test_accept_rejects_already_answered_clarification() -> None:
    values = _pending_values()
    values["turn_records"][0]["status"] = "complete"
    values["turn_records"][0]["clarify"]["response"] = {"v": 2, "mode": "widget", "answers": []}
    graph = FakeGraph(values)
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph,
            "sess-1",
            in_reply_to="a1-msg",
            widget_response_payload={
                "mode": "widget",
                "answers": [{"question_id": "q1", "option_ids": ["q1_o1"]}],
            },
        )
    assert exc.value.code == "clarification_stale"
    assert graph.updates == []


async def test_accept_rejects_mismatched_in_reply_to() -> None:
    graph = FakeGraph(_pending_values())
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph,
            "sess-1",
            in_reply_to="some-other-message",
            widget_response_payload={
                "mode": "widget",
                "answers": [{"question_id": "q1", "option_ids": ["q1_o1"]}],
            },
        )
    assert exc.value.code == "clarification_stale"
    assert graph.updates == []


async def test_accept_rejects_unknown_option_id() -> None:
    graph = FakeGraph(_pending_values())
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph,
            "sess-1",
            in_reply_to="a1-msg",
            widget_response_payload={
                "mode": "widget",
                "answers": [{"question_id": "q1", "option_ids": ["not-a-real-option"]}],
            },
        )
    assert exc.value.code == "unknown_option"
    assert graph.updates == []


async def test_accept_rejects_missing_question() -> None:
    graph = FakeGraph(_pending_values())
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph,
            "sess-1",
            in_reply_to="a1-msg",
            widget_response_payload={"mode": "widget", "answers": []},
        )
    assert exc.value.code == "question_mismatch"
    assert graph.updates == []


async def test_accept_rejects_both_widget_and_composer_bodies() -> None:
    graph = FakeGraph(_pending_values())
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph,
            "sess-1",
            in_reply_to="a1-msg",
            widget_response_payload={"mode": "widget", "answers": []},
            composer_text="also this",
        )
    assert exc.value.code == "malformed_response"
    assert graph.updates == []


async def test_accept_rejects_legacy_v1_pending_spec() -> None:
    values = _pending_values()
    values["turn_records"][0]["clarify"]["spec"] = {
        "v": 1,
        "question": "Which term?",
        "header": "Quick check",
        "multi_select": False,
        "options": [{"label": "Fall", "hint": "h"}, {"label": "Spring", "hint": "h"}],
    }
    graph = FakeGraph(values)
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph, "sess-1", in_reply_to="a1-msg", composer_text="Fall works"
        )
    assert exc.value.code == "clarification_stale"
    assert graph.updates == []


async def test_accept_write_failure_raises_conflict_and_leaves_snapshot_state_alone() -> None:
    graph = FakeGraph(_pending_values())
    graph.fail_update = True
    with pytest.raises(ClarificationConflict) as exc:
        await accept_clarification(
            graph,
            "sess-1",
            in_reply_to="a1-msg",
            widget_response_payload={
                "mode": "widget",
                "answers": [{"question_id": "q1", "option_ids": ["q1_o1"]}],
            },
        )
    assert exc.value.code == "acceptance_write_failed"
    # The FakeGraph only applies `.values.update(...)` on a successful append —
    # a raised aupdate_state must not have mutated the snapshot's records.
    assert graph.values["turn_records"][-1]["status"] == "awaiting_input"


# ---------------------------------------------------------------------------
# ClarifyClaimRegistry
# ---------------------------------------------------------------------------


def test_claim_registry_serializes_a_racing_accept_and_cancel() -> None:
    claims = ClarifyClaimRegistry()
    claims.try_claim("sess-1", kind="accept")
    with pytest.raises(ClarifyClaimBusy):
        claims.try_claim("sess-1", kind="cancel")
    assert claims.phase("sess-1") is OperationPhase.PREPARING
    assert claims.attach_hint("sess-1") == "retry"
    claims.mark_streaming("sess-1")
    assert claims.attach_hint("sess-1") is None
    claims.release("sess-1")
    assert claims.phase("sess-1") is None
    # Released — a cancel claim can now be taken.
    claims.try_claim("sess-1", kind="cancel")
    assert claims.kind("sess-1") == "cancel"


def test_claim_registry_release_is_idempotent_and_never_strands() -> None:
    claims = ClarifyClaimRegistry()
    claims.release("never-claimed")  # must not raise
    claims.try_claim("sess-2", kind="accept")
    claims.release("sess-2")
    claims.release("sess-2")  # second release is a no-op
    assert claims.phase("sess-2") is None
