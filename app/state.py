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

from pydantic import BaseModel

from counselle_db.catalog import CalendarEntry
from domain.envelope import Citation
from domain.season import Season


class RegisteredSource(BaseModel):
    """One source-registry entry: marker index → citation + label.

    Mirrors ``domain.events.SourceEntry`` (the ``sources`` wire event) — the
    registry in state IS the turn's sources list, dict-encoded.
    """

    index: int
    citation: Citation
    label: str
    #: Optional page description (search-result snippet); ``None`` for DB sources.
    #: Mirrors ``domain.events.SourceEntry.snippet`` so the dict round-trips.
    snippet: str | None = None


class TemporalContext(BaseModel):
    """Today + admissions season + per-source data calendar (rebuilt each turn)."""

    today: str  # ISO date, e.g. "2026-06-10"
    season: Season
    data_calendar: list[CalendarEntry]
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
    - ``temporal``: :class:`TemporalContext` dump — rebuilt by ``prepare``
      every turn, never stale.
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
      this is the node's only way to persist it into the record).
    """

    messages: list[dict[str, Any]]
    source_config: dict[str, Any]
    pending_clarify: dict[str, Any] | None
    source_registry: list[dict[str, Any]]
    viz_emitted: list[dict[str, Any]]
    usage: dict[str, Any]
    temporal: dict[str, Any]
    turn_records: list[dict[str, Any]]
    turn_ids: dict[str, Any] | None
