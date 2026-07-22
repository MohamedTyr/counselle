"""The LangGraph turn state (Phase 4 fixed point; ADR 0019).

THE serde rule (notes-p4-apis §3/§8): everything in ``TurnState`` is
**msgpack-plain** — dicts, lists, str/int/float/bool/None. No pydantic
instances, no dataclasses, no tuples (the checkpointer's JsonPlusSerializer
mangles tuples to lists and will block unregistered types in a future
version). Typed models live at the edges: dump with ``model_dump(mode="json")``
on write, re-validate with the models below (or the domain types) on read.

Messages are PydanticAI ``ModelMessage``s serialized via
``ModelMessagesTypeAdapter.dump_python(msgs, mode="json")`` → ``list[dict]``
(notes §5).
"""

from typing import Any, TypedDict

from pydantic import BaseModel, ConfigDict, Field

from domain.envelope import Citation, EvidenceItem
from domain.season import Season


class RegisteredSource(BaseModel):
    """One source-registry entry: marker index → citation + label.

    Mirrors ``domain.events.SourceEntry`` (the ``sources`` wire event) — the
    registry in state IS the turn's sources list, dict-encoded.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    index: int = Field(ge=1)
    citation: Citation
    label: str
    #: Optional page description (search-result snippet); ``None`` for DB sources.
    #: Mirrors ``domain.events.SourceEntry.snippet`` so the dict round-trips.
    snippet: str | None = None
    evidence: tuple[EvidenceItem, ...] = ()
    evidence_seen_eids: tuple[str, ...] = ()


class TemporalContext(BaseModel):
    """Today + admissions season (rebuilt each turn)."""

    today: str  # ISO date, e.g. "2026-06-10"
    season: Season
    context: str  # the rendered prompt block (ARCHITECTURE §16)


class TurnState(TypedDict, total=False):
    """The graph state for one session thread (``thread_id = session_id``).

    Every value is msgpack-plain (see module docstring). Keys:

    - ``messages``: serialized ModelMessages — ``list[dict]`` from
      ``ModelMessagesTypeAdapter.dump_python(mode="json")``.
    - ``source_config``: ``SourceConfig.model_dump()`` — validated back to
      :class:`domain.specs.SourceConfig` at use.
    - ``pending_clarify``: ``ClarifySpec.model_dump()`` while parked on an
      ``ask_student`` interrupt, else ``None``.
    - ``source_registry``: :class:`RegisteredSource` dicts, one per marker
      ``[n]`` handed to the model this turn.
    - ``viz_emitted``: ``RenderSpec.model_dump()`` dicts emitted this turn.
    - ``usage``: ``domain.events.UsageData.model_dump()`` for the turn.
    - ``tool_result_store``: opaque, msgpack-plain payloads spilled by the tool
      overflow middleware; keys are handles that ``read_tool_result`` can read
      on later turns in the same session.
    - ``temporal``: :class:`TemporalContext` dump — rebuilt by ``prepare``
      every turn, never stale.
    - ``student_context``: the rendered ``{student_context}`` prompt block
      (``app/student_context.py``) — profile + documents + memory for the
      authenticated user, or the neutral unauthenticated line. Rebuilt by
      ``prepare`` every turn, same as ``temporal``.
    - ``turn_records``: one record per assistant turn (``app/records.py``,
      ship-plan G2) — the full-fidelity transcript source. This is an
      **overwrite channel where every writer owns the full list**: each
      writer (node return, parked-clarify write, error write, B2's cancel/
      rewrite) reads the prior list, appends or replaces, and writes the
      WHOLE list — never a partial delta (that's what prevents the
      double-append class; there is no reducer).
    - ``turn_ids``: the in-flight turn's G1 identity (``message_id``,
      ``user_message_id``, and on a clarify resume ``resume_text`` — the
      answer rides ``Command(resume)`` and never enters ``messages``, so
      this is the node's only way to persist it into the record). It also
      carries ``selected_skills`` as the validated current-turn list; the
      agent node revalidates that checkpoint transport before loading any
      selected workflow instructions. Finally it carries ``user_id``
      (``str | None``) from the authenticated HTTP session — ``None`` for
      the eval runner/CLI, which is the agent-tool mount-gate signal a later
      phase reads (ADR 0013: unmounted, not hidden). Also carries
      ``response_mode`` (``"quick"``/``"think"``, msgpack-plain str) and
      ``model`` (the exact resolved ``model_setting`` string) — both
      resolved once by ``run_turn``/the registry from
      :func:`app.model_selection.counselor_model_selection`
      (plans/quick-think-response-mode.md §5.1/§5.2); the agent node
      re-resolves the model from ``response_mode`` rather than trusting
      ``model`` directly, so ``model`` here is audit/record data, not an
      execution input.
    """

    messages: list[dict[str, Any]]
    source_config: dict[str, Any]
    pending_clarify: dict[str, Any] | None
    source_registry: list[dict[str, Any]]
    viz_emitted: list[dict[str, Any]]
    usage: dict[str, Any]
    tool_result_store: dict[str, Any]
    temporal: dict[str, Any]
    student_context: str
    data_picture: str
    turn_records: list[dict[str, Any]]
    turn_ids: dict[str, Any] | None
