"""Goal-mode loop tests (plans/goal-mode-plan.md §6.3 Phase 3). No DB, no
network, no LLM — targeted unit tests for the four behaviors §6.3 requires.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, cast

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RunUsage, UsageLimits

import app.agent_node as an
from app.plan_tool import PlanState
from app.records import build_segments
from app.sources import SourceRegistry
from app.steps import EmissionRouter, StepMapper
from config.settings import ModelPriceTier
from domain.goal import CriterionVerdict, GoalCriterion, GoalLedger, GoalLimits, GoalVerdict


class _NoPriceSettings:
    """Just enough of Settings for `_update_goal_ledger_totals`/`estimate_cost`
    and the `app.model_selection` goal-mode model seams (HIGH-2)."""

    model_prices: dict[str, Any] = {}
    goal_max_model_requests = 90
    goal_max_total_tokens = 10_000_000
    model_goal_judge = ""
    model_goal_criteria = ""
    model_cheap = "google-vertex:gemini-2.5-flash"
    goal_model = ""


def _goal_limits() -> GoalLimits:
    return GoalLimits(
        max_iterations=6, max_wall_clock_s=3600.0, max_cost_usd=3.0, max_consecutive_tool_errors=3
    )


# ---------------------------------------------------------------------------
# 1. Cumulative usage regression (§2.11 — "no bug", asserting existing behavior)
# ---------------------------------------------------------------------------


async def test_shared_run_usage_is_cumulative_across_iterations() -> None:
    """D6: one shared ``RunUsage`` threaded into every ``agent.iter(usage=...)``
    call makes ``result.usage`` cumulative across rounds — the mechanism the
    goal loop depends on, and the "no bug" correction §2.11 makes about
    ``app/usage.py`` (untouched by this phase)."""

    def responder(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(content="ok")])

    agent: Agent[None, str] = Agent(FunctionModel(responder), output_type=[str])
    usage = RunUsage()

    result1 = await agent.run("hello", usage=usage)
    requests_after_1 = usage.requests
    result2 = await agent.run(
        "again", usage=usage, message_history=result1.all_messages()
    )

    assert requests_after_1 == 1
    # The shared object accumulates — never reset per call.
    assert usage.requests == 2
    assert result2.usage.requests == 2
    assert result2.usage.input_tokens >= result1.usage.input_tokens
    assert result2.usage.input_tokens == usage.input_tokens  # same accumulated totals


# ---------------------------------------------------------------------------
# 2. A cancelled goal turn persists its ledger and lands stopped_user
# ---------------------------------------------------------------------------


async def test_cancelled_goal_loop_emits_final_step_with_stopped_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """§2.8: the ledger + terminal status must reach the student BEFORE
    ``CancelledError`` propagates — streamed via `writer`, since the turn
    record itself is never built on a cancelled turn (same as an ordinary
    turn's cancel path, which persists from the stream too)."""

    async def fake_run_once(*args: Any, **kwargs: Any) -> Any:
        raise asyncio.CancelledError()

    monkeypatch.setattr(an, "_run_once", fake_run_once)

    emitted: list[dict[str, Any]] = []

    def writer(chunk: dict[str, Any]) -> None:
        emitted.append(chunk)

    criteria = (GoalCriterion(id="c1", text="Every school has a deadline."),)
    run_once_kwargs: dict[str, Any] = dict(
        turn_deps=None,
        router=None,
        final_writer=None,
        recording_writer=lambda _c: None,
        writer=writer,
        emissions=[],
        handle=None,
        parked_store=None,
        parked_session_id="",
        message_id="m1",
        parked_user_id=None,
        registry=None,
    )

    with pytest.raises(asyncio.CancelledError):
        await an._run_goal_loop(
            cast(Any, object()),
            "Make sure every school has a deadline.",
            None,
            criteria=criteria,
            not_checked_note="Application portals were not checked.",
            limits=cast(Any, object()),
            goal_limits=_goal_limits(),
            settings=_NoPriceSettings(),
            model_setting="google-vertex:gemini-2.5-flash",
            model_settings=None,
            instructions="instructions",
            plan_state=PlanState(),
            injected_model_factory=None,
            shared_usage=RunUsage(),
            run_once_kwargs=run_once_kwargs,
        )

    goal_steps = [
        chunk["data"]
        for chunk in emitted
        if chunk.get("type") == "step" and chunk["data"].get("kind") == "goal"
    ]
    final_steps = [s for s in goal_steps if s["detail"]["goal"]["phase"] == "final"]
    assert len(final_steps) == 1
    assert final_steps[0]["detail"]["goal"]["status"] == "stopped_user"


# ---------------------------------------------------------------------------
# 3. Two iterations produce monotonic, non-colliding step_ids through
#    build_segments (the C7 corruption guard)
# ---------------------------------------------------------------------------


def test_begin_iteration_does_not_reset_the_step_id_counter() -> None:
    router = EmissionRouter(
        writer=lambda _c: None,
        mapper=StepMapper({}, lambda _u: None, lambda _u: None),
    )
    router._counter = 3
    router._closed = True
    router.final_answer_started = True
    router._final_candidate = True
    router._text_buf = "pending answer text"
    router._thinking_buf = "pending thought"
    router._narration_streamed_len = 2

    router.begin_iteration()

    # C7: counter is carried, never reset — this is what keeps step_ids
    # monotonic (and therefore non-colliding) across iterations.
    assert router._counter == 3
    # The six per-iteration-transient fields ARE reset.
    assert router._closed is False
    assert router.final_answer_started is False
    assert router._final_candidate is False
    assert router._text_buf == ""
    assert router._thinking_buf == ""
    assert router._narration_streamed_len == 0


def test_monotonic_step_ids_survive_build_segments_without_collision() -> None:
    """The corruption guard, demonstrated both ways: distinct ids from two
    iterations produce two segments; colliding ids (what a per-iteration
    counter reset would produce) silently overwrite the earlier one."""
    step_iter1 = {
        "step_id": "s1",
        "status": "end",
        "kind": "web_search",
        "label": "Searched the web",
        "tier": "official",
    }
    step_iter2 = {
        "step_id": "s2",  # monotonic — carried counter, never reused
        "status": "end",
        "kind": "web_search",
        "label": "Searched the web again",
        "tier": "official",
    }
    segments = build_segments([("step", step_iter1), ("step", step_iter2)])
    step_segments = [s for s in segments if s["kind"] == "step"]
    assert [s["data"]["step_id"] for s in step_segments] == ["s1", "s2"]
    assert len(step_segments) == 2

    # Contrast: a per-iteration counter reset would reuse "s1" on iteration
    # 2 — build_segments' in-place-replace-on-repeated-id behavior then
    # silently drops iteration 1's step, exactly the corruption C7 forbids.
    colliding = build_segments(
        [("step", step_iter1), ("step", {**step_iter1, "label": "overwritten"})]
    )
    colliding_steps = [s for s in colliding if s["kind"] == "step"]
    assert len(colliding_steps) == 1
    assert colliding_steps[0]["data"]["label"] == "overwritten"


# ---------------------------------------------------------------------------
# 4. The ledger renders at zero (§7.3 gate 3 — never omitted for looking
#    uneventful)
# ---------------------------------------------------------------------------


def test_goal_final_step_ledger_renders_at_zero() -> None:
    criteria = (GoalCriterion(id="c1", text="Every school has a deadline."),)
    ledger = GoalLedger()  # no requests, no tokens, no cost, no iterations

    step = an._goal_step(
        phase="final",
        statement="Make sure every school has a deadline.",
        criteria=criteria,
        verdict=None,
        checked_by_id={},
        ledger=ledger,
        limits=_goal_limits(),
        not_checked_note="Application portals were not checked.",
        requests_limit=90,
        tokens_limit=10_000_000,
        status="stopped_no_progress",
    )

    assert step.detail is not None
    assert step.detail.goal is not None
    detail = step.detail.goal
    # Honesty requirement: a goal run that spent/did nothing still emits its
    # ledger line — zero is a value, never an omission.
    assert detail.requests_used == 0
    assert detail.tokens_used == 0
    assert detail.est_cost_usd == 0.0
    assert detail.total_count == 1
    assert detail.met_count == 0
    assert detail.unchecked_count == 1
    assert detail.status == "stopped_no_progress"
    assert detail.not_checked_note


# ---------------------------------------------------------------------------
# 5. A `[[viz:` marker split across an iteration boundary (Phase 0 spike S7
#    property (c), previously guarded only by a throwaway script)
# ---------------------------------------------------------------------------


async def test_viz_marker_split_across_iteration_boundary_does_not_leak() -> None:
    """Ported from
    ``artifacts/goal-mode/20260916T121305Z-spike/scripts/s7_iteration_safety.py``
    property (c): iteration 1's final answer ends mid-marker (``"[[viz:2"``,
    no closing ``"]]"`` yet); iteration 2's first final-answer text closes it.
    The closing fragment must never leak into iteration 2's rendered prose as
    literal ``"]]"``/``"[[viz:"`` junk, and the card the marker names must be
    emitted exactly once — never dropped, never duplicated.

    Drives the real production entry point (`app.agent_node._run_once`) twice
    over one shared `EmissionRouter`/`_FinalContentPlacementWriter` pair,
    exactly as `_run_goal_loop` does across goal-mode iterations — no
    monkeypatching, unlike the spike script this replaces.
    """
    viz_list: list[dict[str, Any]] = [
        {"kind": "card", "index": 0, "title": "card one"},
        {"kind": "card", "index": 1, "title": "card two"},
    ]
    written_chunks: list[dict[str, Any]] = []

    def writer(chunk: dict[str, Any]) -> None:
        written_chunks.append(chunk)

    final_writer = an._FinalContentPlacementWriter(viz_list, writer)
    router = EmissionRouter(
        writer=final_writer.write,
        mapper=StepMapper({}, lambda _u: None, lambda _u: None),
        on_final_start=final_writer.start_final,
    )
    usage = RunUsage()
    turn_deps = an.TurnDeps(registry=SourceRegistry([]))
    run_once_kwargs: dict[str, Any] = dict(
        turn_deps=turn_deps,
        router=router,
        final_writer=final_writer,
        recording_writer=lambda _c: None,
        writer=writer,
        emissions=[],
        handle=None,
        parked_store=None,
        parked_session_id="",
        message_id="m1",
        parked_user_id=None,
        registry=None,
    )

    # Iteration 1: flushes card 0 via "[[viz:1]]" inline, then ends mid-marker.
    async def iter1_stream(messages: list[ModelMessage], info: AgentInfo) -> Any:
        yield "Here is card one. [[viz:1]] And the next one starts now [[viz:2"

    def iter1_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise AssertionError("non-streaming path should not be used")

    agent1: Agent[Any, str] = Agent(
        FunctionModel(iter1_fn, stream_function=iter1_stream), output_type=[str]
    )
    await an._run_once(
        agent1, "Look this up.", None, usage=usage, limits=UsageLimits(), **run_once_kwargs
    )

    # Iteration 2: the FIRST final-answer text closes iteration 1's split
    # marker, then a second, complete marker flushes card 1.
    async def iter2_stream(messages: list[ModelMessage], info: AgentInfo) -> Any:
        yield "]] more prose continuing the final answer, with card two here: [[viz:2]] done."

    def iter2_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise AssertionError("non-streaming path should not be used")

    agent2: Agent[Any, str] = Agent(
        FunctionModel(iter2_fn, stream_function=iter2_stream), output_type=[str]
    )
    mark2 = len(written_chunks)
    await an._run_once(
        agent2, "Continue.", None, usage=usage, limits=UsageLimits(), **run_once_kwargs
    )

    chunks2 = written_chunks[mark2:]
    delta2 = "".join(c.get("text", "") for c in chunks2 if c.get("type") == "delta")
    viz2 = [c for c in chunks2 if c.get("type") == "viz"]

    # No leaked marker-closing junk, and the prose it was wrapped around
    # survives intact.
    assert "]]" not in delta2
    assert "[[viz:" not in delta2
    assert "more prose continuing the final answer" in delta2

    # Card 1 (from "[[viz:2]]") flushed exactly once; card 0 (already
    # flushed in iteration 1) is never re-emitted here.
    assert sum(1 for c in viz2 if c["spec"]["index"] == 1) == 1
    assert not any(c["spec"]["index"] == 0 for c in viz2)


# ---------------------------------------------------------------------------
# 6. HIGH-2: the judge's spend is priced at its OWN model, not the agent's
# ---------------------------------------------------------------------------


class _PricedSettings:
    """Just enough of Settings to exercise HIGH-2's per-slice pricing: two
    priced model tiers, one 100x the other, so a misattributed slice shows up
    as a large, unmistakable difference rather than a rounding artifact."""

    def __init__(self, model_goal_judge: str) -> None:
        self.model_prices: dict[str, ModelPriceTier] = {
            "cheap-model": ModelPriceTier(input_per_1m=1.0, output_per_1m=1.0),
            "pricey-model": ModelPriceTier(input_per_1m=100.0, output_per_1m=100.0),
        }
        self.model_cheap = "google-vertex:cheap-model"
        self.model_goal_judge = model_goal_judge
        self.model_goal_criteria = ""
        self.goal_model = ""
        self.goal_max_model_requests = 90
        self.goal_max_total_tokens = 10_000_000


async def _run_goal_loop_to_achieved_and_get_cost(
    monkeypatch: pytest.MonkeyPatch, settings: Any
) -> float:
    """Runs one achieved-in-one-round goal loop with fixed, fake token spend
    for the agent iteration (1000 in / 500 out) and the judge call (2000 in /
    200 out), and returns the ledger's final `est_cost_usd` from the "final"
    goal step actually streamed to the student — the same number D14's
    pre-spend budget check compares against `goal_max_cost_usd`.
    """

    async def fake_run_once(*args: Any, **kwargs: Any) -> Any:
        usage = kwargs["usage"]
        usage.input_tokens = (usage.input_tokens or 0) + 1000
        usage.output_tokens = (usage.output_tokens or 0) + 500
        usage.requests += 1
        return an._RunOnceResult(
            result=SimpleNamespace(output="agent answer", all_messages=lambda: []),
            hit_budget=False,
            completion_fallback=None,
            had_tool_error=False,
        )

    async def fake_judge_goal(**kwargs: Any) -> Any:
        usage = kwargs["usage"]
        usage.input_tokens = (usage.input_tokens or 0) + 2000
        usage.output_tokens = (usage.output_tokens or 0) + 200
        usage.requests += 1
        verdict = GoalVerdict(
            criteria=(CriterionVerdict(criterion_id="c1", met=True, reason="done"),),
            critique="",
        )
        return verdict, {"c1": True}

    monkeypatch.setattr(an, "_run_once", fake_run_once)
    monkeypatch.setattr(an, "judge_goal", fake_judge_goal)

    emitted: list[dict[str, Any]] = []

    def writer(chunk: dict[str, Any]) -> None:
        emitted.append(chunk)

    criteria = (GoalCriterion(id="c1", text="Every school has a deadline."),)
    run_once_kwargs: dict[str, Any] = dict(
        turn_deps=None,
        router=None,
        final_writer=None,
        recording_writer=lambda _c: None,
        writer=writer,
        emissions=[],
        handle=None,
        parked_store=None,
        parked_session_id="",
        message_id="m1",
        parked_user_id=None,
        registry=None,
    )

    await an._run_goal_loop(
        cast(Any, object()),
        "Make sure every school has a deadline.",
        None,
        criteria=criteria,
        not_checked_note="Application portals were not checked.",
        limits=cast(Any, object()),
        goal_limits=_goal_limits(),
        settings=settings,
        model_setting="google-vertex:cheap-model",
        model_settings=None,
        instructions="instructions",
        plan_state=PlanState(),
        injected_model_factory=None,
        shared_usage=RunUsage(),
        run_once_kwargs=run_once_kwargs,
    )

    goal_steps = [
        chunk["data"]
        for chunk in emitted
        if chunk.get("type") == "step" and chunk["data"].get("kind") == "goal"
    ]
    final_steps = [s for s in goal_steps if s["detail"]["goal"]["phase"] == "final"]
    assert len(final_steps) == 1
    assert final_steps[0]["detail"]["goal"]["status"] == "achieved"
    return cast(float, final_steps[0]["detail"]["goal"]["est_cost_usd"])


async def test_pricier_judge_tier_shows_up_as_higher_ledger_cost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HIGH-2: `_update_goal_ledger` used to price the ENTIRE shared usage
    (agent iterations + judge/criteria calls, D6) at the agent's own model
    rate. With the agent's spend held fixed (1000 in / 500 out) and the
    judge's spend held fixed (2000 in / 200 out) across both runs, moving
    `model_goal_judge` to a 100x-pricier tier must raise the ledger's final
    `est_cost_usd` — the number shown to the student and checked against
    `goal_max_cost_usd` — even though the token counts never change.
    """
    same_tier_settings = _PricedSettings(model_goal_judge="")  # "" => model_cheap (agent's tier)
    pricier_judge_settings = _PricedSettings(model_goal_judge="google-vertex:pricey-model")

    cost_same_tier = await _run_goal_loop_to_achieved_and_get_cost(monkeypatch, same_tier_settings)
    cost_pricier_judge = await _run_goal_loop_to_achieved_and_get_cost(
        monkeypatch, pricier_judge_settings
    )

    assert cost_pricier_judge > cost_same_tier
    # Sanity: the same-tier run prices everything at $1/1M -> (1000+500+2000+200)/1e6.
    assert cost_same_tier == pytest.approx(3700 / 1_000_000)
    # The pricier run keeps the agent's slice at $1/1M but reprices the
    # judge's 2000in/200out slice at $100/1M -> the difference is dominated
    # by that slice, not a rounding artifact.
    assert cost_pricier_judge == pytest.approx(1500 / 1_000_000 + 220_000 / 1_000_000)


# ---------------------------------------------------------------------------
# 7. HIGH-4: `partial` is reachable end to end (consecutive tool errors)
# ---------------------------------------------------------------------------


async def test_partial_status_is_reachable_after_consecutive_tool_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """HIGH-4: `domain.goal.decide_terminal_status` returns "partial" once
    `ledger.consecutive_tool_errors >= limits.max_consecutive_tool_errors`,
    but nothing previously incremented that counter — the branch was dead.
    `_run_once`'s `had_tool_error` flag (surfaced from its own tool-result
    event walk, without touching `app/steps.py`) now wires it: one
    tool-erroring iteration against a limit of 1 must land `partial`.
    """

    async def fake_run_once(*args: Any, **kwargs: Any) -> Any:
        usage = kwargs["usage"]
        usage.requests += 1
        return an._RunOnceResult(
            result=SimpleNamespace(output="agent answer", all_messages=lambda: []),
            hit_budget=False,
            completion_fallback=None,
            had_tool_error=True,
        )

    async def fake_judge_goal(**kwargs: Any) -> Any:
        verdict = GoalVerdict(
            criteria=(CriterionVerdict(criterion_id="c1", met=False, reason="not yet"),),
            critique="still working",
        )
        return verdict, {"c1": True}

    monkeypatch.setattr(an, "_run_once", fake_run_once)
    monkeypatch.setattr(an, "judge_goal", fake_judge_goal)

    emitted: list[dict[str, Any]] = []

    def writer(chunk: dict[str, Any]) -> None:
        emitted.append(chunk)

    criteria = (GoalCriterion(id="c1", text="Every school has a deadline."),)
    run_once_kwargs: dict[str, Any] = dict(
        turn_deps=None,
        router=None,
        final_writer=None,
        recording_writer=lambda _c: None,
        writer=writer,
        emissions=[],
        handle=None,
        parked_store=None,
        parked_session_id="",
        message_id="m1",
        parked_user_id=None,
        registry=None,
    )
    limits = GoalLimits(
        max_iterations=6, max_wall_clock_s=3600.0, max_cost_usd=3.0, max_consecutive_tool_errors=1
    )
    # The wrap-up (§2.7) always runs for a non-achieved status; give it a
    # harmless FunctionModel so building its Agent needs no real credentials
    # (`_run_once` itself is faked above regardless of which agent is passed).
    wrapup_model = FunctionModel(
        lambda messages, info: ModelResponse(parts=[TextPart(content="wrap-up")])
    )

    await an._run_goal_loop(
        cast(Any, object()),
        "Make sure every school has a deadline.",
        None,
        criteria=criteria,
        not_checked_note="Application portals were not checked.",
        limits=cast(Any, object()),
        goal_limits=limits,
        settings=_NoPriceSettings(),
        model_setting="google-vertex:gemini-2.5-flash",
        model_settings=None,
        instructions="instructions",
        plan_state=PlanState(),
        injected_model_factory=lambda: wrapup_model,
        shared_usage=RunUsage(),
        run_once_kwargs=run_once_kwargs,
    )

    goal_steps = [
        chunk["data"]
        for chunk in emitted
        if chunk.get("type") == "step" and chunk["data"].get("kind") == "goal"
    ]
    final_steps = [s for s in goal_steps if s["detail"]["goal"]["phase"] == "final"]
    assert len(final_steps) == 1
    assert final_steps[0]["detail"]["goal"]["status"] == "partial"
