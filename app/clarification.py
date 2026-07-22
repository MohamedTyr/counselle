"""``ask_student`` output-tool wiring + v2 pending-clarification lifecycle.

Focused Phase 2 module (plans/clarifying-questions.md, "Backend implementation
slices" — Phase 2, "File-level change map"): keeps ``app/agent_node.py`` and
``app/run_turn.py`` as wiring only. Three responsibilities:

- :func:`ask_student_output_type` — the normal-run PydanticAI ``output_type``
  list (architecture decision §1: ``ToolOutput(ClarifyDraftV2,
  name="ask_student")`` beside plain ``str``). Factored out as its own callable
  — not inlined into the ``Agent(...)`` construction — so a future
  continuation run (Phase 3's A2) can trivially build its own
  ``output_type=[str]`` without duplicating or drifting from this list.
- :func:`build_pending_clarification` — a validated ``ClarifyDraftV2`` model
  result -> the durable ``PendingClarificationV2`` dict. This is A1's
  versioned clarify record and the sole source of truth for the spec (plan
  architecture decision §3): never persist a second copy of it elsewhere.
- :func:`latest_awaiting_v2_clarify_spec` — reads the just-committed
  ``turn_records`` to recover the v2 spec for ``run_turn``'s post-commit
  ``clarify`` -> ``sources`` -> optional ``usage`` -> ``done(awaiting_input)``
  event order (plan Phase 2). Legacy v1 parked/resume clarify keeps its
  existing ``__interrupt__``-based event path untouched.

This module is not ``app/clarify.py`` (the legacy interrupt-backed
``ask_student`` tool, kept minimal/unchanged for compatibility) — see that
module's docstring for why the two are deliberately separate.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from pydantic_ai.output import ToolOutput

from domain.clarification import (
    ClarifyDraftV2,
    ClarifySpecV2,
    PendingClarificationV2,
    normalize_clarify_draft,
    parse_clarify_spec,
)


def ask_student_output_type() -> list[Any]:
    """The normal-run output type: plain prose or one validated ask_student draft.

    A future A2 continuation run (Phase 3) must NOT advertise ``ask_student`` —
    its constructor should pass ``output_type=[str]`` directly rather than
    calling this helper, so a second clarification round stays impossible even
    if the model ignores the prompt.
    """
    return [str, ToolOutput(ClarifyDraftV2, name="ask_student")]


def build_pending_clarification(draft: ClarifyDraftV2) -> dict[str, Any]:
    """Normalize a valid ``ask_student`` draft into A1's durable clarify record.

    ``PendingClarificationV2`` (a spec, no response yet) is the ONLY v2 clarify
    state persisted on the turn record — never a second copy of the spec.
    """
    spec = normalize_clarify_draft(draft)
    return PendingClarificationV2(spec=spec, response=None).model_dump(mode="json")


def latest_awaiting_v2_clarify_spec(
    records: Sequence[Mapping[str, Any]] | None,
) -> ClarifySpecV2 | None:
    """The just-persisted turn's v2 spec, if this turn ended ``awaiting_input``.

    Used only to recover the post-commit event order for a native v2 pending
    turn. Returns ``None`` for a normal completion, a legacy v1 parked record,
    or any malformed/missing shape — never raises.
    """
    if not records:
        return None
    latest = records[-1]
    if latest.get("status") != "awaiting_input":
        return None
    clarify = latest.get("clarify")
    if not isinstance(clarify, Mapping):
        return None
    spec_payload = clarify.get("spec")
    if not isinstance(spec_payload, Mapping):
        return None
    parsed = parse_clarify_spec(spec_payload)
    return parsed if isinstance(parsed, ClarifySpecV2) else None
