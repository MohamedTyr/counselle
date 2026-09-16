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
from app.goal_judge import GoalCriteriaError
from app.goal_loop import criterion_views
from app.plan_tool import PlanState
from app.records import build_segments
from app.run_handle import RunHandle
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
# 0. C9 wire view: an omitted (never-assessed) criterion must never present
#    as "checked and failed" on the wire.
# ---------------------------------------------------------------------------


def test_criterion_views_omitted_criterion_is_unchecked_and_unmet() -> None:
    criterion = GoalCriterion(id="c1", text="do the thing")
    verdict = GoalVerdict(
        criteria=(CriterionVerdict(criterion_id="c1", met=None, reason="", evidence_step_ids=()),),
        critique="ran out of time",
    )
    views = criterion_views([criterion], verdict, checked_by_id={"c1": False})
    assert len(views) == 1
    view = views[0]
    assert view.met is None
    assert view.checked is False


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
# 2. A cancelled goal turn streams its ledger and names only a REAL student Stop
# ---------------------------------------------------------------------------


async def _drive_cancelled_goal_loop(
    monkeypatch: pytest.MonkeyPatch, *, cause: str
) -> list[dict[str, Any]]:
    """Run `_run_goal_loop` to a cancellation, by either cause, and return
    everything it streamed before `CancelledError` propagated.

    Both causes deliver the SAME bare `task.cancel()` from outside the run —
    the only difference is the one the registry itself makes: `_cancel_active`
    (the student's Stop) marks `RunHandle.cancelled_by_user` before cancelling,
    and `_drain_active_with_error` (BC-15) does not. A live handle is passed on
    both paths so the mark, not the handle's mere presence, is what is under
    test. `tests/app/test_turns.py` covers the registry side of that seam.
    """
    started = asyncio.Event()

    async def fake_run_once(*args: Any, **kwargs: Any) -> Any:
        started.set()
        await asyncio.sleep(3600)
        raise AssertionError("unreachable")

    monkeypatch.setattr(an, "_run_once", fake_run_once)
    handle = RunHandle(session_id="s-goal-cancel")

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
        handle=handle,
        parked_store=None,
        parked_session_id="",
        message_id="m1",
        parked_user_id=None,
        registry=None,
    )
    coro = an._run_goal_loop(
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
    task = asyncio.create_task(coro)
    await started.wait()
    if cause == "user_stop":
        # What `app/turns.py::_cancel_active` does, in its order: mark the
        # handle synchronously, THEN cancel.
        handle.cancelled_by_user = True
    # Byte for byte what BOTH `_cancel_active` and `_drain_active_with_error`
    # do to the turn task — a bare `task.cancel()`, carrying nothing on the
    # exception that says which one it was.
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    return emitted


@pytest.mark.parametrize("cause", ["user_stop", "shutdown_drain"])
async def test_cancelled_goal_loop_streams_its_ledger_and_claims_only_a_real_stop(
    monkeypatch: pytest.MonkeyPatch, cause: str
) -> None:
    """§2.8: the ledger + last verdict must reach the student BEFORE
    ``CancelledError`` propagates — streamed via `writer`, since the turn
    record itself is never built on a cancelled turn (same as an ordinary
    turn's cancel path, which persists from the stream too).

    The step claims a terminal status ONLY on the student's own Stop.
    ``app/turns.py`` cancels the same task for two different reasons — a
    student's Stop (done(cancelled)) and a shutdown drain (error, BC-15: the
    student never pressed anything) — so `stopped_user` on the drain would
    render "Stopped — you stopped it" at a student who was redeployed out
    from under them. The drain therefore claims nothing and the frontend's
    crash rule shows it as "Stopped — interrupted"; the genuine Stop is
    reported precisely.
    """
    emitted = await _drive_cancelled_goal_loop(monkeypatch, cause=cause)

    goal_steps = [
        chunk["data"]
        for chunk in emitted
        if chunk.get("type") == "step" and chunk["data"].get("kind") == "goal"
    ]
    final_steps = [s for s in goal_steps if s["detail"]["goal"]["phase"] == "final"]
    assert len(final_steps) == 1
    detail = final_steps[0]["detail"]["goal"]
    assert detail["status"] == ("stopped_user" if cause == "user_stop" else None)
    # §2.8's actual payload still reaches the student on both causes.
    assert detail["total_count"] == 1
    assert detail["not_checked_note"]


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


# ---------------------------------------------------------------------------
# 8. C12 through the loop: a judge that gives out mid-run lands
#    `stopped_check_failed`, keeps its ledger, and still gets its wrap-up
# ---------------------------------------------------------------------------


async def test_judge_failure_mid_run_lands_stopped_check_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """C12 end to end, not just in `decide_terminal_status`: `judge_goal`
    returning ``None`` (its retries exhausted) must stop the loop at
    `stopped_check_failed`, report the spend it already made rather than a
    clean zero, leave every criterion unchecked (C9 — a check that never
    completed is not a failed criterion), and still run the §2.7 wrap-up so
    the student gets prose explaining it, the same as any non-achieved stop.
    """
    iterations = 0

    async def fake_run_once(*args: Any, **kwargs: Any) -> Any:
        nonlocal iterations
        iterations += 1
        usage = kwargs["usage"]
        usage.input_tokens = (usage.input_tokens or 0) + 1000
        usage.output_tokens = (usage.output_tokens or 0) + 500
        usage.requests += 1
        return an._RunOnceResult(
            result=SimpleNamespace(output=f"run-{iterations}", all_messages=lambda: []),
            hit_budget=False,
            completion_fallback=None,
            had_tool_error=False,
        )

    async def fake_judge_goal(**kwargs: Any) -> Any:
        # §3.7/C12: `judge_goal` swallows its own transport failures and
        # returns None once `goal_judge_retries` is exhausted.
        return None

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
    wrapup_model = FunctionModel(
        lambda messages, info: ModelResponse(parts=[TextPart(content="wrap-up")])
    )

    result, _fallback = await an._run_goal_loop(
        cast(Any, object()),
        "Make sure every school has a deadline.",
        None,
        criteria=criteria,
        not_checked_note="Application portals were not checked.",
        limits=cast(Any, object()),
        goal_limits=_goal_limits(),
        settings=_PricedSettings(model_goal_judge=""),
        model_setting="google-vertex:cheap-model",
        model_settings=None,
        instructions="instructions",
        plan_state=PlanState(),
        injected_model_factory=lambda: wrapup_model,
        shared_usage=RunUsage(),
        run_once_kwargs=run_once_kwargs,
    )

    # Exactly two `_run_once` calls: ONE governed round (a failed check never
    # nudges for another — there is no verdict to nudge from), then the §2.7
    # wrap-up, which runs through `_run_once` on its own tool-less Agent.
    assert iterations == 2
    goal_steps = [
        chunk["data"]
        for chunk in emitted
        if chunk.get("type") == "step" and chunk["data"].get("kind") == "goal"
    ]
    final_steps = [s for s in goal_steps if s["detail"]["goal"]["phase"] == "final"]
    assert len(final_steps) == 1
    detail = final_steps[0]["detail"]["goal"]
    assert detail["status"] == "stopped_check_failed"
    # C9: never checked is never "checked and failed".
    assert detail["met_count"] == 0
    assert detail["unchecked_count"] == 1
    assert detail["criteria"][0]["met"] is None
    assert detail["criteria"][0]["checked"] is False
    # The ledger reports what the round actually spent.
    assert detail["requests_used"] >= 1
    assert detail["tokens_used"] >= 1500
    assert detail["est_cost_usd"] > 0
    # §2.7: a non-achieved stop still gets its tool-less wrap-up, and it is
    # the wrap-up's output — not the failed round's — that the student reads.
    assert result is not None
    assert result.output == "run-2"


# ---------------------------------------------------------------------------
# 9. A criteria-derivation failure reaches the student as
#    `stopped_check_failed`, not a generic turn error
# ---------------------------------------------------------------------------


class _NodeSettings(_NoPriceSettings):
    """The slice of Settings `run_agent_node` reads on a goal turn."""

    model_counselor = "google-vertex:gemini-2.5-pro"
    model_counselor_think = "google-vertex:gemini-3.1-pro-preview"
    response_mode_think_enabled = True
    agent_max_model_requests = 80
    agent_max_total_tokens = 2_000_000
    compaction_clear_tool_results_after_messages = 40
    compaction_clear_tool_keep_pairs = 3
    compaction_min_clear_tokens = 20_000
    goal_compaction_target_tokens = 100_000
    goal_compaction_keep_tokens = 8_000
    thinking_stream = True
    thinking_summaries: bool | None = None
    thinking_threshold_chars = 240
    agent_tool_result_max_chars = 8_000
    essay_context_max_chars = 8_000
    goal_max_iterations = 6
    goal_max_wall_clock_s = 3600.0
    goal_max_cost_usd = 3.0
    goal_max_consecutive_tool_errors = 3
    goal_wrapup_reserve_requests = 2

    @property
    def effective_thinking_stream(self) -> bool:
        return self.thinking_stream if self.thinking_summaries is None else self.thinking_summaries


def _goal_node_state(prompt: str) -> dict[str, Any]:
    from pydantic_ai.messages import (
        ModelMessagesTypeAdapter,
        ModelRequest,
        UserPromptPart,
    )

    from domain.specs import SourceConfig

    messages = ModelMessagesTypeAdapter.dump_python(
        [ModelRequest(parts=[UserPromptPart(content=prompt)])], mode="json"
    )
    return {
        "messages": messages,
        "source_registry": [],
        "source_config": SourceConfig(web=False, edu=False, reddit=False).model_dump(mode="json"),
        "temporal": {"today": "2026-09-16", "context": "It is September 2026."},
        "turn_ids": {
            "message_id": "assistant-1",
            "user_message_id": "user-1",
            "goal_mode": True,
        },
        "turn_records": [],
        "tool_result_store": {},
    }


async def test_criteria_derivation_failure_emits_stopped_check_failed_step(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """§5.2 point 3b: derivation giving out after its retries is the SAME
    fact as the judge giving out mid-run (C12), so it lands on the SAME
    terminal state — a `phase: "final"` step carrying `stopped_check_failed`
    and no criteria, which the goal card renders as "Counselle couldn't work
    out how to check this goal."

    Left to propagate, `GoalCriteriaError` reaches run_turn's generic
    failure path instead: the student gets "Something went wrong on our
    side" with no goal card at all, and the frontend's dedicated branch for
    this state is unreachable. The turn must also END here — no model call,
    since the criteria ARE the contract a goal run is governed by (C2/D12).
    """
    from types import SimpleNamespace as NS

    async def boom(*args: Any, **kwargs: Any) -> Any:
        raise GoalCriteriaError("criteria derivation failed after retries")

    emitted: list[dict[str, Any]] = []

    monkeypatch.setattr(an, "derive_criteria", boom)
    monkeypatch.setattr(an, "get_stream_writer", lambda: emitted.append)
    monkeypatch.setattr(an, "build_tools", lambda *args, **kwargs: [])
    monkeypatch.setattr(
        an, "_run_once", lambda *a, **k: pytest.fail("no model run without criteria")
    )

    deps = cast(
        Any,
        NS(
            catalog=NS(school_count=0, school_name=None, school_domain=None),
            app_pool=None,
            settings=_NodeSettings(),
            run_handles=None,
            parked_sources=None,
            workspace_events=None,
            tool_deps=NS(),
            model_factory=lambda: FunctionModel(
                lambda messages, info: ModelResponse(parts=[TextPart(content="unused")])
            ),
        ),
    )

    state = _goal_node_state("Make sure every school has a deadline.")
    delta = await an.run_agent_node(state, deps)

    goal_steps = [
        chunk["data"]
        for chunk in emitted
        if chunk.get("type") == "step" and chunk["data"].get("kind") == "goal"
    ]
    assert len(goal_steps) == 1
    detail = goal_steps[0]["detail"]["goal"]
    assert detail["phase"] == "final"
    assert detail["status"] == "stopped_check_failed"
    assert detail["criteria"] == []
    # The turn still completes as a turn — the specific card is the answer,
    # never a generic error banner stacked on top of it.
    assert delta["turn_records"][-1]["status"] == "complete"
