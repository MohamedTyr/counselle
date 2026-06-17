"""Single owner of terminal turn persistence + the lifecycle predicates.

Every terminal path — the node's happy/budget path, run_turn's parked and
error writes, the registry's cancel/timeout — builds the same record shape and
the same ``messages`` delta through THIS module. The empty-partial rule and the
offset anchoring live here once (was: four "KEEP IN SYNC" copies, audit H1).

The transcript is the honesty surface (ARCHITECTURE §27.7 G2): the prose
invariant — ``messages`` keeps exactly the prose that streamed — is enforced in
:func:`partial_messages` and nowhere else.
"""

from __future__ import annotations

from typing import Any

from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelResponse,
    TextPart,
)

from app.records import (
    Emission,
    TurnStatus,
    append_or_replace,
    build_turn_record,
    now_iso,
)

#: The LangGraph agent node name — MUST equal ``app.graph``'s
#: ``add_node("agent", ...)``. The ``as_node=`` anchor for unpark /
#: history-rewrite (the graph must believe the agent ran). Single source of
#: truth; imported by graph.py and turns.py (audit H2 / BC-11 / BC-14).
AGENT_NODE = "agent"


# -- lifecycle predicates (shared with H2) --------------------------------


def is_parked(records: list[dict[str, Any]]) -> bool:
    """The thread is parked on a clarify iff the last record is ``awaiting_input``.

    The turn record is the single source of truth (B0 spike 1: the parked
    record write empties ``tasks[*].interrupts``). No interrupt-fallback OR —
    see audit BC-14 / H2.
    """
    return bool(records) and records[-1].get("status") == "awaiting_input"


def parked_record(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The parked clarify record, or ``None`` when the thread is not parked."""
    return records[-1] if is_parked(records) else None


def resolve_offset(explicit: int | None, messages: list[dict[str, Any]]) -> int:
    """The turn's ``messages_offset``: the caller's authoritative value when it
    has one, else the tail-request fallback (the user ``ModelRequest`` is the
    tail on a new turn; for direct-graph invocations the len-1 fallback covers
    it)."""
    if isinstance(explicit, int):
        return explicit
    if messages and messages[-1].get("kind") == "request":
        return len(messages) - 1
    return len(messages)


# -- the empty-partial rule (the prose invariant) -------------------------


def partial_messages(
    messages: list[dict[str, Any]], emissions: list[Emission]
) -> tuple[list[dict[str, Any]], bool]:
    """Apply the empty-partial rule once.

    Returns ``(messages, changed)``. Appends a partial ``ModelResponse``
    carrying the concatenated delta prose ONLY when prose streamed AND the tail
    message is a ``request`` to anchor it. No prose (or no request tail) →
    unchanged (an empty-content response corrupts the provider history).
    """
    prose = "".join(text for kind, text in emissions if kind == "delta")
    if not prose or not messages or messages[-1].get("kind") != "request":
        return messages, False
    partial = ModelResponse(parts=[TextPart(content=prose)])
    appended = messages + list(
        ModelMessagesTypeAdapter.dump_python([partial], mode="json")
    )
    return appended, True


# -- the one aupdate_state payload builder --------------------------------


def build_terminal_update(
    *,
    messages: list[dict[str, Any]],
    records: list[dict[str, Any]],
    emissions: list[Emission],
    ids: dict[str, Any],
    status: TurnStatus,
    sources: list[dict[str, Any]],
    user_text: str | None,
    messages_offset: int | None,
    usage: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
    clarify: dict[str, Any] | None = None,
    synthesized_answer: bool = False,
) -> dict[str, Any]:
    """The single ``aupdate_state`` payload for ANY terminal path.

    Computes the messages delta (empty-partial rule), builds the record, and
    returns ``{"turn_records": …, ["messages": …]}`` — the ``messages`` key is
    present only when the partial actually changed it. The caller passes the
    snapshot's ``messages``/``records`` and the emissions it observed; nothing
    else differs across vantages.
    """
    new_messages, changed = partial_messages(messages, emissions)
    record = build_turn_record(
        emissions,
        ids=ids,
        status=status,
        sources=sources,
        user_text=user_text,
        usage=usage,
        error=error,
        clarify=clarify,
        ts=now_iso(),
        messages_offset=resolve_offset(messages_offset, new_messages),
        synthesized_answer=synthesized_answer,
    )
    update: dict[str, Any] = {"turn_records": append_or_replace(records, record)}
    if changed:
        update["messages"] = new_messages
    return update
