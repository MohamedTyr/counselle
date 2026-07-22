"""Phase 3 clarification acceptance + A2 continuation lifecycle.

(plans/clarifying-questions.md, "Architecture decision" §4/§5, "Backend
implementation slices" — Phase 3.)

This is the focused module Phase 3 asks for: classification, claimed
validation, atomic A1-acceptance, and the prepared-continuation projection
that ``app/run_turn.py``'s ``run_continuation_turn`` and ``app/turns.py``'s
``TurnRegistry.start_continuation``/``accept_clarification`` wire into the
existing seams. Nothing here duplicates A1's stored spec/response — every
projection is derived from the durable record, never a second copy.

Three responsibilities:

- :func:`classify_clarify_request` — normal / widget-answer / composer-answer
  / legacy-answer, decided BEFORE any claim is taken (plan Phase 3: "Answer-
  shaped requests must be classified before the ordinary ``StreamActive``
  branch").
- :func:`accept_clarification` — claimed, immutable A1 update + durable
  ``ContinuationIntent`` write in one ``graph.aupdate_state`` call (plan
  architecture decision §4 step 4). Returns a :class:`PreparedContinuation`
  or raises :class:`ClarificationConflict` with a stable, terse ``code`` —
  every failure path leaves checkpoint state untouched.
- :class:`ClarifyClaimRegistry` — the per-session ``preparing`` ->
  ``streaming`` -> ``finalized`` phase, serializing a racing cancel/delete
  against an in-flight acceptance (plan Phase 3: "insert the claim
  synchronously before any checkpoint await"). Full route-level wiring of
  cancel/delete against this claim is Phase 5 (API/protocol) scope; this
  module only owns the claim primitive and the accept-side integration.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal
from uuid import uuid4

from app.turn_persistence import AGENT_NODE
from domain.clarification import (
    ClarifyResponseInvalid,
    ClarifySpecV2,
    ContinuationIntent,
    ReplyClarifyResponseV2,
    WidgetClarifyResponseV2,
    parse_clarify_spec,
    render_clarify_model_payload,
    validate_clarify_response,
)

logger = logging.getLogger(__name__)


class ClarifyRequestKind(StrEnum):
    """The four request shapes Phase 3 must distinguish before any claim."""

    NORMAL = "normal"
    WIDGET_ANSWER = "widget_answer"
    COMPOSER_ANSWER = "composer_answer"
    LEGACY_ANSWER = "legacy_answer"


class ClarificationConflict(Exception):
    """A typed, stable-code state conflict (plan: e.g. ``clarification_stale``).

    The route maps this to one stable conflict envelope/status distinct from
    the generic active-turn 409 (plan "POST message request" / Phase 3
    bullet: "never reaches generic 409 cancel-and-retry behavior"). Every
    raise site here leaves checkpoint state completely untouched.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def classify_clarify_request(
    *,
    clarify_response: Mapping[str, Any] | None,
    text: str | None,
    has_pending_v2: bool,
    has_pending_legacy: bool,
) -> ClarifyRequestKind:
    """Classify a POST message body BEFORE any claim/``StreamActive`` check.

    - a structured ``clarify_response`` body is always a widget answer;
    - plain ``text`` while a v2 pending clarification exists is a composer
      answer (Phase 5 wires ``in_reply_to`` validation against the pending
      A1's id; this function only decides the request SHAPE);
    - plain ``text`` while only a legacy v1 clarification is pending keeps the
      existing ``app/clarify.py`` compatibility path;
    - anything else is a normal turn.
    """
    if clarify_response is not None:
        return ClarifyRequestKind.WIDGET_ANSWER
    if text is not None and has_pending_v2:
        return ClarifyRequestKind.COMPOSER_ANSWER
    if text is not None and has_pending_legacy:
        return ClarifyRequestKind.LEGACY_ANSWER
    return ClarifyRequestKind.NORMAL


@dataclass(frozen=True)
class PreparedContinuation:
    """Everything A2 needs, carried as separate fields (plan architecture
    decision §5) rather than one ambiguous string.

    ``record_user_text``/``user_message_id`` are the exact transcript
    projection — ``None`` for a widget origin even on later cancel/error/
    timeout; the composer origin's exact U2 text/id for a reply origin.
    ``model_input_text`` is server-rendered content transport only, never an
    editable user bubble or record anchor.
    """

    root_message_id: str
    continuation_message_id: str
    trigger_request_id: str
    origin: Literal["widget", "reply"]
    completed_message_history: list[dict[str, Any]]
    model_input_text: str
    project_user: bool
    record_user_text: str | None
    user_message_id: str | None
    inherited_skills: tuple[str, ...]
    inherited_source_config: dict[str, Any] | None
    messages_offset: int


async def accept_clarification(
    graph: Any,
    session_id: str,
    *,
    in_reply_to: str | None,
    widget_response_payload: Mapping[str, Any] | None = None,
    composer_text: str | None = None,
    composer_user_message_id: str | None = None,
) -> PreparedContinuation:
    """Validate + atomically accept A1's clarification; prepare A2.

    Exactly one of ``widget_response_payload`` or ``composer_text`` must be
    given (the caller's classification already decided which). Must be called
    under the session's registry claim (plan Phase 3: "claim the session
    before reading pending state") — this function itself performs no
    claiming, only the read-validate-write.

    Every failure path raises :class:`ClarificationConflict` with a stable
    code and leaves ``turn_records``/state completely untouched — no partial
    write, no cleared checkpoint (plan: "leaves checkpoint state untouched").
    """
    if (widget_response_payload is None) == (composer_text is None):
        raise ClarificationConflict("malformed_response")

    config = {"configurable": {"thread_id": session_id}}
    snapshot = await graph.aget_state(config)
    values = dict(snapshot.values) if snapshot else {}
    records = list(values.get("turn_records") or [])
    messages = list(values.get("messages") or [])

    latest = records[-1] if records else None
    if latest is None or latest.get("status") != "awaiting_input":
        raise ClarificationConflict("clarification_stale")
    clarify_block = latest.get("clarify")
    if not isinstance(clarify_block, dict) or clarify_block.get("response") is not None:
        raise ClarificationConflict("clarification_stale")
    spec_payload = clarify_block.get("spec")
    if not isinstance(spec_payload, dict):
        raise ClarificationConflict("clarification_stale")
    try:
        parsed_spec = parse_clarify_spec(spec_payload)
    except Exception as exc:
        raise ClarificationConflict("clarification_stale") from exc
    if not isinstance(parsed_spec, ClarifySpecV2):
        # A pending legacy v1 record is not this path's target — the caller's
        # classification (LEGACY_ANSWER) must route there instead.
        raise ClarificationConflict("clarification_stale")

    a1_message_id = str(latest.get("message_id"))
    if in_reply_to is not None and in_reply_to != a1_message_id:
        raise ClarificationConflict("clarification_stale")

    origin: Literal["widget", "reply"]
    response: ReplyClarifyResponseV2 | WidgetClarifyResponseV2
    if composer_text is not None:
        try:
            response = ReplyClarifyResponseV2(
                text=composer_text,
                user_message_id=composer_user_message_id or str(uuid4()),
            )
        except Exception as exc:
            raise ClarificationConflict("malformed_response") from exc
        model_input_text = composer_text
        project_user = True
        record_user_text: str | None = composer_text
        user_message_id: str | None = response.user_message_id
        origin = "reply"
    else:
        try:
            widget_response = WidgetClarifyResponseV2.model_validate(widget_response_payload)
        except Exception as exc:
            raise ClarificationConflict("malformed_response") from exc
        try:
            answers = validate_clarify_response(parsed_spec, widget_response)
        except ClarifyResponseInvalid as exc:
            raise ClarificationConflict(exc.code) from exc
        response = widget_response
        model_input_text = render_clarify_model_payload(parsed_spec, answers)
        project_user = False
        record_user_text = None
        user_message_id = None
        origin = "widget"

    inherited_skills = tuple(str(name) for name in (latest.get("skills") or []))
    inherited_source_config_raw = values.get("source_config")
    inherited_source_config = (
        dict(inherited_source_config_raw) if isinstance(inherited_source_config_raw, dict) else None
    )

    a2_message_id = str(uuid4())
    trigger_request_id = str(uuid4())

    # Immutable A1 update: replace the last record only, never mutate `latest`
    # or `records` in place. A1's status moves pending -> answered
    # ("complete" — plan "Turn-record identity"); `clarify.response` is the
    # ONLY place the answer is stored (no second copy).
    answered_record = {
        **latest,
        "status": "complete",
        "clarify": {"spec": spec_payload, "response": response.model_dump(mode="json")},
    }
    updated_records = records[:-1] + [answered_record]

    intent = ContinuationIntent(
        phase="accepted",
        root_message_id=a1_message_id,
        continuation_message_id=a2_message_id,
        trigger_request_id=trigger_request_id,
        response_origin=origin,
        inherited_skills=inherited_skills,
        inherited_source_config=inherited_source_config,
    )
    try:
        await graph.aupdate_state(
            config,
            {
                "turn_records": updated_records,
                "continuation_intent": intent.model_dump(mode="json"),
            },
            as_node=AGENT_NODE,
        )
    except Exception as exc:
        # The pre-accept boundary is retryable (plan architecture decision
        # §4): a write failure here leaves A1 pending/untouched — nothing was
        # persisted, so the draft stays interactive.
        raise ClarificationConflict("acceptance_write_failed") from exc

    return PreparedContinuation(
        root_message_id=a1_message_id,
        continuation_message_id=a2_message_id,
        trigger_request_id=trigger_request_id,
        origin=origin,
        completed_message_history=messages,
        model_input_text=model_input_text,
        project_user=project_user,
        record_user_text=record_user_text,
        user_message_id=user_message_id,
        inherited_skills=inherited_skills,
        inherited_source_config=inherited_source_config,
        messages_offset=len(messages),
    )


# --- per-session preparing -> streaming -> finalized claim ------------------


class OperationPhase(StrEnum):
    PREPARING = "preparing"
    STREAMING = "streaming"
    FINALIZED = "finalized"


class ClarifyClaimBusy(Exception):
    """A concurrent accept/cancel claim already holds this session's clarify
    lifecycle claim (plan Phase 3: "serialize pending cancel/delete against
    answer acceptance with the same claim")."""


@dataclass
class _SessionClaim:
    phase: OperationPhase
    kind: Literal["accept", "cancel"]


class ClarifyClaimRegistry:
    """One serialization boundary for clarify acceptance vs. a racing
    cancel/delete, shared across a session.

    ``try_claim`` is synchronous and raises immediately on contention — no
    ``await`` between the check and the claim (plan: "insert the claim
    synchronously before any checkpoint await"), mirroring
    ``TurnRegistry.start``'s own single-flight window. This is intentionally a
    SEPARATE claim from ``TurnRegistry._turns``: acceptance can be mid-flight
    (a checkpoint read/write, no turn task yet) before A2's task exists, and a
    cancel/delete arriving in that window must serialize against THIS claim,
    not the turn-task dict.
    """

    def __init__(self) -> None:
        self._claims: dict[str, _SessionClaim] = {}

    def try_claim(self, session_id: str, *, kind: Literal["accept", "cancel"]) -> None:
        if session_id in self._claims:
            raise ClarifyClaimBusy(session_id)
        self._claims[session_id] = _SessionClaim(phase=OperationPhase.PREPARING, kind=kind)

    def mark_streaming(self, session_id: str) -> None:
        claim = self._claims.get(session_id)
        if claim is not None:
            claim.phase = OperationPhase.STREAMING

    def release(self, session_id: str) -> None:
        """Release unconditionally — every preparation failure must release
        its claim so it can never strand a follower (plan Phase 3)."""
        self._claims.pop(session_id, None)

    def phase(self, session_id: str) -> OperationPhase | None:
        claim = self._claims.get(session_id)
        return claim.phase if claim else None

    def kind(self, session_id: str) -> Literal["accept", "cancel"] | None:
        claim = self._claims.get(session_id)
        return claim.kind if claim else None

    def attach_hint(self, session_id: str) -> Literal["retry"] | None:
        """While ``preparing``, an attach must return a bounded retry/ready
        result rather than follow an unstarted empty buffer (plan Phase 3).
        Route-level wiring of this hint into the SSE attach response is Phase
        5 scope; this is the query surface that wiring will call."""
        return "retry" if self.phase(session_id) is OperationPhase.PREPARING else None
