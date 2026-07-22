"""The turn record builder (MVP2 B1b — ship-plan §0.1 G1/G2, wire-contract §2/§7).

One record per assistant turn, stored in graph state (``TurnState.turn_records``)
and serialized into the transcript wire shape by the API read. Everything here
is msgpack-plain (the ``app/state.py`` rule) — the record rides the LangGraph
checkpointer.

Design points (decided in the ship plan, not here):

- **One builder, split text feeds.** The agent node and ``run_turn`` both observe
  the same ordered emission stream (``("delta", text) | ("viz", spec) |
  ("step", data) | ("narration", text) | ("thinking", text) |
  ("user", data)`` tuples);
  :func:`build_turn_record` turns it into the record regardless of which writer
  calls it.
- **The record is self-contained.** ``parts[]`` carries the materialized prose
  (``{"type": "text", "text"}``) — never offsets into ``messages``. The
  transcript read must NEVER reconstruct prose by slicing ``messages``: the
  streamed deltas and the persisted model history can legitimately diverge
  (thinking-classified text parts, clarify replays), and the record is the
  honesty surface — it stores exactly what the student saw.
- **``segments[]`` is the chronological replay surface.** It is msgpack-plain
  (plain dicts only), keeps narration/thinking/answer/viz/step order, coalesces
  adjacent answer deltas, and updates a step's first start segment in place when
  the matching terminal step arrives.
- **The receipt format is the FE contract** (wire-contract §7): the
  ``deriveReceipt`` activity line from ``turn-reducer.ts``, implemented
  server-side so persisted receipts equal what the FE derived live.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from app.viz_signature import viz_payload_signature
from domain.events import DoneStatus

#: Cheap stopgap narrowing — the full per-kind discriminated union is deferred to B2.
#: ``"clarify"`` (plans/clarifying-questions.md, architecture decision §3) is a
#: bare positional marker — no payload — appended once, only for a v2
#: ``ask_student`` result, immediately after any pre-question work. It has no
#: bearing on ``parts`` (answer/viz compatibility data only): the spec/response
#: live solely on the record's ``clarify`` field, and this emission exists only
#: so ``build_segments`` can place a ``{"kind": "clarify"}`` pointer at the
#: correct chronological position for reload.
Emission = tuple[
    Literal["delta", "viz", "step", "thinking", "narration", "user", "clarify"],
    Any,
]

#: The terminal statuses a turn record can carry: the wire ``DoneStatus`` set
#: (``complete``/``awaiting_input``/``cancelled``) plus ``error`` (record-only,
#: never on the wire) — defined in terms of the wire vocabulary so the two can
#: never drift (audit M7). Typo-proof at call sites.
TurnStatus = DoneStatus | Literal["error"]


class FinalEmissionDeduper:
    def __init__(self) -> None:
        self._seen_viz: set[str] = set()

    def keep(self, kind: str, payload: Any) -> bool:
        if kind != "viz":
            return True
        signature = viz_payload_signature(payload)
        if signature in self._seen_viz:
            return False
        self._seen_viz.add(signature)
        return True


def now_iso() -> str:
    """The record timestamp: ISO-8601 UTC at the turn's terminal."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def build_parts(emissions: list[Emission]) -> list[dict[str, Any]]:
    """Walk emissions in stream order → materialized ``parts[]`` (wire §2.2).

    Adjacent deltas merge into one ``{"type": "text", "text"}`` segment; empty
    deltas are skipped; a viz splits the surrounding text. The text is stored
    verbatim (not offsets) so the record stands alone — the read never slices
    ``messages`` to recover what streamed.
    """
    parts: list[dict[str, Any]] = []
    segment: list[str] = []
    deduper = FinalEmissionDeduper()
    for kind, payload in emissions:
        if kind == "delta":
            if payload:
                segment.append(payload)
        elif kind == "viz":
            if not deduper.keep(kind, payload):
                continue
            if segment:
                parts.append({"type": "text", "text": "".join(segment)})
                segment = []
            parts.append({"type": "viz", "spec": payload})
    if segment:
        parts.append({"type": "text", "text": "".join(segment)})
    return parts


def build_segments(emissions: list[Emission]) -> list[dict[str, Any]]:
    """Walk emissions in stream order → ordered replay ``segments[]``.

    ``segments`` is not a replacement for compatibility fields. ``parts`` stays
    answer-only, ``steps`` stays terminal-only, and ``segments`` carries the
    full visible chronology for reload/replay. A step segment is inserted at
    the first ``start`` event and updated in place by the later ``end``/``error``
    event with the same ``step_id``.
    """
    segments: list[dict[str, Any]] = []
    delta_segment: list[str] = []
    step_index_by_id: dict[str, int] = {}
    user_index_by_id: dict[str, int] = {}
    deduper = FinalEmissionDeduper()

    def flush_delta() -> None:
        nonlocal delta_segment
        if delta_segment:
            segments.append({"kind": "delta", "text": "".join(delta_segment)})
            delta_segment = []

    for kind, payload in emissions:
        if kind == "delta":
            if payload:
                delta_segment.append(payload)
            continue
        if kind == "viz" and not deduper.keep(kind, payload):
            continue

        flush_delta()
        if kind in ("narration", "thinking"):
            if payload:
                segments.append({"kind": kind, "text": payload})
        elif kind == "viz":
            segments.append({"kind": "viz", "spec": payload})
        elif kind == "step":
            step_id = str(payload.get("step_id", ""))
            index = step_index_by_id.get(step_id)
            segment = {"kind": "step", "data": payload}
            if index is None:
                step_index_by_id[step_id] = len(segments)
                segments.append(segment)
            else:
                segments[index] = segment
        elif kind == "user":
            user_message_id = str(payload.get("user_message_id", ""))
            segment = {
                "kind": "user",
                "text": str(payload.get("text") or ""),
                "user_message_id": user_message_id,
                "injected": bool(payload.get("injected")),
            }
            index = user_index_by_id.get(user_message_id)
            if index is None:
                user_index_by_id[user_message_id] = len(segments)
                segments.append(segment)
            else:
                segments[index] = segment
        elif kind == "clarify":
            # A bare pointer — the spec/response live only on the record's
            # top-level ``clarify`` field (architecture decision §3: never a
            # second copy). At most one per A1, always the last visible thing
            # (the question IS the turn's terminal output).
            segments.append({"kind": "clarify"})

    flush_delta()
    return [
        segment
        for segment in segments
        if segment.get("kind") != "user" or bool(segment.get("injected"))
    ]


def prose_of(parts: list[dict[str, Any]]) -> str:
    """The turn's full prose: the record's text parts, concatenated.

    The one source for "the assistant's text" — both the record's implicit
    text and the transcript read derive from the same materialized parts.
    """
    return "".join(part.get("text", "") for part in parts if part.get("type") == "text")


def derive_receipt(steps: list[dict[str, Any]], thinking: list[str]) -> str:
    """The one-line activity receipt — byte-compatible with the FE's
    ``deriveReceipt`` (wire-contract §7, the pinned consumer contract).

    Counting unit = one step (one ``step_id``); segments joined by ``' · '``
    in fixed order, zero-count segments omitted; empty string when the turn
    had zero steps and zero thinking lines.
    """
    if not steps and not thinking:
        return ""
    kind_by_id: dict[str, str] = {}
    for step in steps:
        kind_by_id[str(step.get("step_id"))] = str(step.get("kind"))
    kinds = list(kind_by_id.values())
    db = sum(1 for k in kinds if k in ("db_tool", "sql"))
    web = sum(1 for k in kinds if k in ("web_search", "edu_search"))
    reddit = sum(1 for k in kinds if k == "reddit_search")
    viz = sum(1 for k in kinds if k == "viz")
    # Clamp defensively (BC-20): with the current StepKind literal the buckets
    # are disjoint so this is already >= 0, but a future kind that joins two
    # buckets would underflow to a nonsense "-1 steps" — never show that.
    other = max(0, len(kinds) - db - web - reddit - viz)
    labels: list[str] = []
    if db:
        labels.append(f"{db} database {'lookup' if db == 1 else 'lookups'}")
    if web:
        labels.append(f"{web} web {'search' if web == 1 else 'searches'}")
    if reddit:
        labels.append(f"{reddit} Reddit {'search' if reddit == 1 else 'searches'}")
    if viz:
        labels.append(f"{viz} {'visualization' if viz == 1 else 'visualizations'}")
    if other:
        labels.append(f"{other} {'step' if other == 1 else 'steps'}")
    return " · ".join(labels)


def build_turn_record(
    emissions: list[Emission],
    *,
    ids: dict[str, Any],
    status: TurnStatus,
    sources: list[dict[str, Any]],
    user_text: str | None = None,
    usage: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
    clarify: dict[str, Any] | None = None,
    ts: str | None = None,
    messages_offset: int,
    synthesized_answer: bool = False,
    selected_skills: Sequence[str] | None = None,
    continuation_of: str | None = None,
    source_config: dict[str, Any] | None = None,
    editable_root_message_id: str | None = None,
    trigger_request_id: str | None = None,
    response_origin: Literal["widget", "reply"] | None = None,
    project_user: bool | None = None,
) -> dict[str, Any]:
    """One turn record (ship-plan §0.1 G2), msgpack-plain and self-contained.

    ``steps`` keeps only the end-state step events (``end``/``error`` — the
    timeline's final truth; ``start`` frames are live-stream-only).
    ``user_text`` is the turn's question, stored so the transcript read never
    digs into ``messages`` for the user bubble (``None`` for pre-MVP2 records).
    ``messages_offset`` is the index of this turn's user ``ModelRequest`` in
    ``state["messages"]`` — server-internal, never on the wire, and used ONLY
    as B2's G3 history-rewrite anchor: the transcript read no longer slices
    against it (the record is self-contained).
    """
    steps = [
        payload
        for kind, payload in emissions
        if kind == "step" and payload.get("status") != "start"
    ]
    narration = [payload for kind, payload in emissions if kind == "narration"]
    thinking = [payload for kind, payload in emissions if kind == "thinking"]
    return {
        "message_id": ids["message_id"],
        "user_message_id": ids["user_message_id"],
        # plans/quick-think-response-mode.md §6.1: required in validated
        # ``ids`` — reading them here (once) is what keeps complete/error/
        # park/cancel/timeout records from ever independently diverging.
        # Absent ``response_mode`` means Quick (legacy/pre-feature callers);
        # absent ``model`` stays absent — never fabricate what served an
        # answer Counselle doesn't actually know.
        "response_mode": ids.get("response_mode") or "quick",
        "model": ids.get("model"),
        "user_text": user_text,
        # Only ``None`` denotes an omitted legacy selection.  Do not coerce
        # other falsy/corrupt values (for example ``False``) to an innocent
        # empty list: callers validate the persisted selection at their
        # boundary, and a bad value must fail loudly instead of being erased.
        "skills": list(selected_skills) if selected_skills is not None else [],
        "parts": build_parts(emissions),
        "segments": build_segments(emissions),
        "steps": steps,
        "narration": narration,
        "thinking": thinking,
        "receipt": derive_receipt(steps, thinking),
        "sources": sources,
        "usage": usage,
        "status": status,
        "error": error,
        "clarify": clarify,
        "ts": ts or now_iso(),
        "messages_offset": messages_offset,
        "synthesized_answer": synthesized_answer,
        # Phase 3 (plan architecture decision §2): A2's link back to its root
        # A1. ``None`` for every ordinary/legacy record — a v2 continuation is
        # the only writer of a non-None value here.
        "continuation_of": continuation_of,
        # Phase 4 (plan "Persist an immutable source_config snapshot on every
        # v2 A1"): populated ONLY by the agent node when this record is a
        # fresh v2 ``ask_student`` result. ``None`` for every other record —
        # legacy v1 keeps its existing sticky-session fallback and never
        # claims an inherited config the stored data can't prove.
        "source_config": source_config,
        # Phase 4 (plan "Turn-record identity" / "Expose
        # editable_root_message_id=U1"): U1's own ``user_message_id`` — equal
        # to this record's own ``user_message_id`` on A1, and threaded onto a
        # v2 continuation (A2) so either record names the same deterministic
        # edit/regenerate root without cross-referencing. ``None`` for legacy
        # v1 and for a normal (non-v2) turn with nothing to name.
        "editable_root_message_id": editable_root_message_id,
        # Phase 4 ("Turn-record identity"): A2's internal trigger request and
        # projection metadata. These fields are intentionally explicit so the
        # transcript/action layer never infers widget vs. composer origin from
        # a missing user bubble or overloaded message id.
        "trigger_request_id": trigger_request_id,
        "response_origin": response_origin,
        "project_user": project_user,
        "clarification_reply": bool(continuation_of and response_origin == "reply"),
    }


def _is_v2_clarify(record: dict[str, Any]) -> bool:
    clarify = record.get("clarify")
    return isinstance(clarify, dict) and isinstance(clarify.get("spec"), dict) and (
        clarify["spec"].get("v") == 2
    )


def append_or_replace(
    prior: list[dict[str, Any]], record: dict[str, Any]
) -> list[dict[str, Any]]:
    """The full new ``turn_records`` list for an overwrite-channel write.

    A clarify resume re-runs the parked turn under the same ``message_id``
    (G4): when the prior list's last record is that turn still parked
    (``awaiting_input``, same id), the new record REPLACES it — one assistant
    message, one record, however many park/resume cycles produced it.
    Never mutates ``prior`` (house immutability rule).

    Phase 4 (plan "Restrict append_or_replace ... to legacy v1 behavior
    only"): a v2 pending A1 is NEVER re-run through this legacy replace path —
    once accepted it moves straight to ``complete`` via
    :func:`replace_latest_pending_v2`, and a fresh v2 A1 always gets its own
    new ``message_id``. If a caller's ``prior``/``record`` pair somehow still
    matches the legacy replace shape while the parked record is v2, that is a
    caller bug, not a legitimate resume — append instead of silently
    misapplying v1 replace semantics to a v2 record.
    """
    if (
        prior
        and prior[-1].get("status") == "awaiting_input"
        and prior[-1].get("message_id") == record.get("message_id")
        and not _is_v2_clarify(prior[-1])
    ):
        return prior[:-1] + [record]
    return prior + [record]


def replace_latest_pending_v2(
    prior: list[dict[str, Any]], record: dict[str, Any]
) -> list[dict[str, Any]]:
    """The v2-specific twin of the legacy replace branch above.

    Immutably replaces the latest pending v2 A1 with its answered form (or any
    other in-place update of that same record) — used by
    ``app.clarify_lifecycle.accept_clarification``. Unlike
    :func:`append_or_replace`, this never falls back to appending: the caller
    has already validated ``prior[-1]`` is the exact pending v2 A1 being
    updated, so a mismatch here is a caller bug that must fail loudly rather
    than silently duplicate or skip the record.
    """
    if not prior:
        raise ValueError("no prior records to update")
    latest = prior[-1]
    if latest.get("status") != "awaiting_input" or latest.get("message_id") != record.get(
        "message_id"
    ):
        raise ValueError("target is not the latest pending record")
    return prior[:-1] + [record]


def find_root_user_message_id(
    records: list[dict[str, Any]], root_message_id: str | None
) -> str | None:
    """A2's ``editable_root_message_id``: A1's own ``user_message_id``.

    Looks up A1 (identified by its ``message_id == root_message_id``) among
    already-persisted records and returns the ``user_message_id`` it retained
    from U1 (plan "Turn-record identity": "A1 retains U1's
    ``user_message_id``"). Returns ``None`` when there is no
    ``root_message_id`` or no matching record — never raises, since this is a
    best-effort forward-compat field, not a correctness-critical anchor.
    """
    if root_message_id is None:
        return None
    for record in records:
        if record.get("message_id") == root_message_id:
            value = record.get("user_message_id")
            return str(value) if value is not None else None
    return None
