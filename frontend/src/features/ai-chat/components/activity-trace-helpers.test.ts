import { describe, expect, test } from "vitest";

import type { GoalStepDetail, StepData } from "@/api/chat/types";

import type { Segment } from "../turn-reducer";
import { isInterruptedGoal, latestGoalStep } from "./activity-trace-helpers";

function goalDetail(overrides: Partial<GoalStepDetail>): GoalStepDetail {
  return {
    phase: "check",
    statement: "Every school has a deadline",
    status: null,
    iteration: 1,
    max_iterations: 6,
    criteria: [],
    critique: null,
    met_count: 0,
    total_count: 0,
    unchecked_count: 0,
    not_checked_note: "",
    requests_used: 0,
    requests_limit: 60,
    tokens_used: 0,
    tokens_limit: 100_000,
    est_cost_usd: 0,
    cost_limit_usd: 5,
    elapsed_s: 0,
    ...overrides,
  };
}

function goalStep(detail: GoalStepDetail | null, stepId = "goal-1"): StepData {
  return {
    step_id: stepId,
    status: "end",
    kind: "goal",
    label: "Checking against the goal",
    tier: null,
    tool: undefined,
    detail: detail === null ? null : { goal: detail },
  };
}

function toolSegment(step: StepData): Segment {
  return { type: "tool", step };
}

describe("latestGoalStep", () => {
  test("returns the latest tool segment whose kind is goal and detail.goal is populated", () => {
    const detail = goalDetail({ iteration: 2 });
    const segments: Segment[] = [
      toolSegment(goalStep(goalDetail({ iteration: 1 }), "goal-0")),
      toolSegment(goalStep(detail, "goal-1")),
    ];

    expect(latestGoalStep(segments)?.step_id).toBe("goal-1");
  });

  test("skips a goal step with no detail.goal payload yet (mirrors latestPlanStep's guard)", () => {
    const segments: Segment[] = [
      toolSegment(goalStep(goalDetail({ iteration: 1 }), "goal-0")),
      toolSegment(goalStep(null, "goal-1")),
    ];

    expect(latestGoalStep(segments)?.step_id).toBe("goal-0");
  });

  test("returns null when there is no goal step at all", () => {
    const segments: Segment[] = [
      { type: "narration", id: "n1", text: "hello" },
    ];

    expect(latestGoalStep(segments)).toBeNull();
  });

  test("ignores non-goal tool steps", () => {
    const otherStep: StepData = {
      step_id: "web-1",
      status: "end",
      kind: "web_search",
      label: "Searching",
      tier: "community",
      tool: "search_web",
      detail: null,
    };
    const segments: Segment[] = [toolSegment(otherStep)];

    expect(latestGoalStep(segments)).toBeNull();
  });
});

describe("isInterruptedGoal", () => {
  test("is false when there is no goal step", () => {
    const message = { messageId: "m1", segments: [] as Segment[] };
    expect(isInterruptedGoal(message, null)).toBe(false);
  });

  test("is false while the run is genuinely still streaming (this IS the live message)", () => {
    const segments: Segment[] = [
      toolSegment(goalStep(goalDetail({ status: null }))),
    ];
    const message = { messageId: "m1", segments };

    expect(isInterruptedGoal(message, "m1")).toBe(false);
  });

  test("is false once a phase:final step gives a real terminal status, even if not live", () => {
    const segments: Segment[] = [
      toolSegment(goalStep(goalDetail({ phase: "final", status: "achieved" }))),
    ];
    const message = { messageId: "m1", segments };

    expect(isInterruptedGoal(message, null)).toBe(false);
  });

  test("is true for a settled replay with a null status and no live turn — the crash case", () => {
    const segments: Segment[] = [
      toolSegment(goalStep(goalDetail({ status: null }))),
    ];
    const message = { messageId: "m1", segments };

    // Not the live message (liveMessageId is a different turn, or null).
    expect(isInterruptedGoal(message, null)).toBe(true);
    expect(isInterruptedGoal(message, "some-other-message")).toBe(true);
  });
});
