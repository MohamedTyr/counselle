"""TurnState serde round-trip: msgpack-plain, no pydantic leaks (notes-p4-apis §8)."""

import json
import warnings
from typing import Any

from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from pydantic import BaseModel
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)

from app.state import RegisteredSource, TemporalContext, TurnState
from domain.envelope import Citation, CitationEnvelope
from domain.events import UsageData
from domain.season import Season
from domain.specs import ClarifyOption, ClarifySpec, RenderSpec, SchoolRef, SourceConfig, VizRow


def _citation() -> Citation:
    return Citation(
        source="profile",
        tier="official",
        vintage="Profile 2024",
        school_unitid=198419,
        profile_sha256="a" * 64,
    )


def _render_spec() -> RenderSpec:
    cell = CitationEnvelope(
        field="admissions.acceptance_rate",
        label="Acceptance rate",
        display="6.2%",
        raw=0.062,
        available=True,
        unit="percent",
        citation=_citation(),
        marker="[1]",
    )
    return RenderSpec(
        type="stat_block",
        title="Duke University at a glance",
        columns=[SchoolRef(unitid=198419, name="Duke University")],
        rows=[VizRow(label="Acceptance rate", cells=[cell])],
    )


def _full_state() -> TurnState:
    """A fully-populated TurnState, every value dict-dumped from the real models."""
    messages = ModelMessagesTypeAdapter.dump_python(
        [
            ModelRequest(parts=[UserPromptPart(content="Tell me about Duke")]),
            ModelResponse(parts=[TextPart(content="Duke admits 6.2% [1].")]),
        ],
        mode="json",
    )
    clarify = ClarifySpec(
        question="Which campus do you mean?",
        header="Campus",
        multi_select=False,
        options=[
            ClarifyOption(label="Main campus", hint="Durham, NC"),
            ClarifyOption(label="Kunshan", hint="The China campus"),
        ],
    )
    temporal = TemporalContext(
        today="2026-06-10",
        season=Season(
            phase="pre-application",
            description="List building.",
            entering_class="Fall 2027",
            cycle_note="It is the pre-application phase.",
        ),
        context="Today is 2026-06-10.",
    )
    return TurnState(
        messages=messages,
        source_config=SourceConfig(web=True, reddit=False, edu=True).model_dump(mode="json"),
        pending_clarify=clarify.model_dump(mode="json"),
        source_registry=[
            RegisteredSource(index=1, citation=_citation(), label="Profile 2024").model_dump(
                mode="json"
            )
        ],
        viz_emitted=[_render_spec().model_dump(mode="json")],
        usage=UsageData(input_tokens=120, output_tokens=80, tool_calls=3).model_dump(mode="json"),
        temporal=temporal.model_dump(mode="json"),
    )


def _assert_plain(value: Any) -> None:
    """Recursively assert msgpack-plain: dict/list/str/int/float/bool/None only."""
    assert not isinstance(value, BaseModel), f"pydantic object leaked into state: {value!r}"
    assert not isinstance(value, tuple), f"tuple in state (mangles to list): {value!r}"
    if isinstance(value, dict):
        for key, item in value.items():
            assert isinstance(key, str)
            _assert_plain(item)
    elif isinstance(value, list):
        for item in value:
            _assert_plain(item)
    else:
        assert value is None or isinstance(value, str | int | float | bool), repr(value)


def test_full_state_is_msgpack_plain() -> None:
    state = _full_state()

    _assert_plain(dict(state))
    json.dumps(state)  # JSON-serializable is the plainness proxy


def test_full_state_survives_checkpointer_serde_unwarned() -> None:
    # Arrange: the checkpointer's real serializer (ormsgpack-based).
    serde = JsonPlusSerializer()
    state = _full_state()

    # Act
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        restored = serde.loads_typed(serde.dumps_typed(dict(state)))

    # Assert: identical round-trip, no "unregistered type" serde warnings.
    assert restored == dict(state)
    unregistered = [w for w in caught if "unregistered" in str(w.message).lower()]
    assert not unregistered, f"serde warned about unregistered types: {unregistered}"


def test_messages_revalidate_after_round_trip() -> None:
    serde = JsonPlusSerializer()
    state = _full_state()

    restored = serde.loads_typed(serde.dumps_typed(dict(state)))

    # The serialized messages must validate back into ModelMessages (notes §5),
    # and the spec dicts back into their models — validation at the edges.
    messages = ModelMessagesTypeAdapter.validate_python(restored["messages"])
    first_part = messages[1].parts[0]
    assert isinstance(first_part, TextPart)
    assert first_part.content == "Duke admits 6.2% [1]."
    assert SourceConfig.model_validate(restored["source_config"]).reddit is False
    assert ClarifySpec.model_validate(restored["pending_clarify"]).question
    assert RegisteredSource.model_validate(restored["source_registry"][0]).index == 1
    assert RenderSpec.model_validate(restored["viz_emitted"][0]).type == "stat_block"
    assert UsageData.model_validate(restored["usage"]).tool_calls == 3
    assert TemporalContext.model_validate(restored["temporal"]).today == "2026-06-10"
