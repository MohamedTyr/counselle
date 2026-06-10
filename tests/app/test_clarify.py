"""Unit tests for the ``ask_student`` clarify tool (Phase 4 Slice D).

The interrupt round-trip is exercised through a tiny one-node graph with the
in-memory checkpointer (notes-p4-apis §7): invoke → the graph parks and the
ClarifySpec dict surfaces in ``__interrupt__``; resume via
``Command(resume=...)`` → the node RE-EXECUTES from its start and the answer
becomes the tool's return value. The node counts its executions so the
re-execution semantics are observable, not assumed.
"""

from typing import Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from app.clarify import ask_student

TWO_OPTIONS = [
    {"label": "My intended major", "hint": "programs, rigor, outcomes in your field"},
    {"label": "Cost & affordability", "hint": "net price for your situation"},
]
FIVE_OPTIONS = [{"label": f"Option {n}", "hint": "too many"} for n in range(5)]


class _State(TypedDict, total=False):
    answer: str
    node_runs: int


def _build_graph(
    options: list[dict[str, Any]] | None, counter: dict[str, int]
) -> CompiledStateGraph[_State, Any, Any, Any]:
    """One node that calls ask_student and records how often it executed."""

    def ask_node(state: _State) -> dict[str, Any]:
        counter["runs"] += 1
        answer = ask_student("Good for what?", "What matters", options)
        return {"answer": answer, "node_runs": counter["runs"]}

    builder = StateGraph(_State)
    builder.add_node("ask", ask_node)
    builder.add_edge(START, "ask")
    builder.add_edge("ask", END)
    return builder.compile(checkpointer=InMemorySaver())


def test_interrupt_surfaces_clarify_spec_then_resume_returns_answer() -> None:
    counter = {"runs": 0}
    graph = _build_graph(TWO_OPTIONS, counter)
    config: RunnableConfig = {"configurable": {"thread_id": "clarify-roundtrip"}}

    parked = graph.invoke({}, config)

    # The graph parked: the ClarifySpec dict surfaces in __interrupt__ ...
    interrupts = parked["__interrupt__"]
    spec = interrupts[0].value
    assert spec["question"] == "Good for what?"
    assert spec["header"] == "What matters"
    assert spec["multi_select"] is False
    assert 2 <= len(spec["options"]) <= 4
    assert spec["options"][0] == TWO_OPTIONS[0]
    # ... before the node returned anything.
    assert "answer" not in parked
    assert counter["runs"] == 1

    resumed = graph.invoke(Command(resume="CS and cost"), config)

    # The student's answer is the tool's return value ...
    assert resumed["answer"] == "CS and cost"
    assert "__interrupt__" not in resumed
    # ... and the node RE-EXECUTED from its start on resume (notes §7) — the
    # state written by the completed run is from the SECOND execution.
    assert counter["runs"] == 2
    assert resumed["node_runs"] == 2


def test_more_than_four_options_returns_constraint_error_without_interrupting() -> None:
    counter = {"runs": 0}
    graph = _build_graph(FIVE_OPTIONS, counter)
    config: RunnableConfig = {"configurable": {"thread_id": "clarify-too-many"}}

    result = graph.invoke({}, config)

    assert "__interrupt__" not in result  # never parked
    assert counter["runs"] == 1  # single execution, no replay
    assert result["answer"].startswith("ask_student error:")
    assert "between 2 and 4 options" in result["answer"]


def test_missing_options_returns_constraint_error_outside_any_graph() -> None:
    # Validation precedes interrupt(), so no graph context is needed at all.
    result = ask_student("Good for what?", "What matters", options=None)
    assert result.startswith("ask_student error:")


def test_one_option_returns_constraint_error() -> None:
    result = ask_student("Good for what?", "What matters", options=[TWO_OPTIONS[0]])
    assert result.startswith("ask_student error:")


def test_malformed_option_returns_constraint_error() -> None:
    bad = [{"label": "no hint here"}, {"label": "ok", "hint": "ok"}]
    result = ask_student("Good for what?", "What matters", options=bad)
    assert result.startswith("ask_student error:")
