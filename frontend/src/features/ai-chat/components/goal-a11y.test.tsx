import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test } from "vitest";

import type { GoalStatus, StepData } from "@/api/chat/types";
import {
  GOAL_CRITERION_HONESTY_FIXTURE,
  GOAL_MODE_FIXTURES,
} from "@/features/dev-tool-call-gallery/tool-call-fixtures";

import { GoalCheckBeat } from "./GoalBeat";
import { GoalHeader } from "./GoalHeader";
import { GoalVerdictCard } from "./GoalVerdictCard";

expect.extend(toHaveNoViolations);

/**
 * Automated accessibility smoke test (plans/goal-mode-plan.md §5.7). Like
 * the mutation-receipt a11y suite this mirrors, axe-core in jsdom cannot
 * verify real computed color contrast or exercise a live screen reader —
 * §7.4's live pass is still required. What this DOES catch reliably:
 * invalid/missing ARIA, unlabeled interactive controls, and duplicate ids
 * across all goal-mode fixtures.
 */
describe("goal header accessibility", () => {
  test.each(
    GOAL_MODE_FIXTURES.map(
      (fixture) => [fixture.id, fixture] as const,
    ),
  )("%s has no automatically-detectable a11y violations", async (_id, fixture) => {
    const { container } = render(
      <GoalHeader
        detail={fixture.detail}
        isInterrupted={fixture.isInterrupted}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("goal verdict card accessibility", () => {
  const terminalFixtures = GOAL_MODE_FIXTURES.filter(
    (fixture) => fixture.detail.status !== null && fixture.detail.criteria.length > 0,
  );

  test.each(terminalFixtures.map((fixture) => [fixture.id, fixture] as const))(
    "%s has no automatically-detectable a11y violations",
    async (_id, fixture) => {
      const { container } = render(<GoalVerdictCard detail={fixture.detail} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
  );
});

/**
 * C9 regression: "not done" is not the same as "not checked" (found by
 * post-ship review 2026-09-16). A criterion the judge never assessed must
 * never render as one it assessed and failed — `met: false` alone must
 * never be enough to show "not met"; `checked` decides.
 */
describe("goal criterion honesty (C9)", () => {
  const guardFixture = GOAL_CRITERION_HONESTY_FIXTURE;

  test("a met:false, checked:false criterion renders as not checked, never as not met", () => {
    // The goal line lists the criteria only while no verdict exists — once
    // one does, the result below carries them (next test). An interrupted
    // run is the no-verdict state where "not checked" is permanent.
    render(
      <GoalHeader detail={{ ...guardFixture.detail, status: null }} isInterrupted />,
    );
    fireEvent.click(screen.getByRole("button", { name: /done when/i }));

    // c3 (met:false, checked:false) and c4 (met:null, checked:false) both
    // read "not checked". Only c2 (met:false, checked:true) is a genuine
    // failure.
    expect(screen.getByText(guardFixture.detail.criteria[2].text)).toBeInTheDocument();
    expect(screen.getAllByText("not checked:")).toHaveLength(2);
    expect(screen.getAllByText("not met:")).toHaveLength(1);
  });

  test("the same pairing on the closing card renders as not checked, never as not met", () => {
    render(<GoalVerdictCard detail={guardFixture.detail} />);

    expect(screen.getAllByText("not checked:")).toHaveLength(2);
    expect(screen.getAllByText("not met:")).toHaveLength(1);
  });

  test("GoalCheckBeat never renders an empty outstanding segment for an unnamed criterion", () => {
    const step: StepData = {
      step_id: "s1",
      status: "end",
      kind: "goal",
      label: "Checked against the goal",
      tier: null,
      detail: {
        goal: {
          phase: "check",
          statement: "test goal",
          status: null,
          iteration: 1,
          max_iterations: 6,
          criteria: [
            {
              id: "c1",
              text: "Every school has a note",
              met: false,
              checked: false,
              reason: "",
              evidence_step_ids: [],
            },
          ],
          critique: null,
          met_count: 0,
          total_count: 1,
          unchecked_count: 1,
          not_checked_note: "",
          requests_used: 1,
          requests_limit: 60,
          tokens_used: 0,
          tokens_limit: 400_000,
          est_cost_usd: 0,
          cost_limit_usd: 5,
          elapsed_s: 10,
        },
      },
    };

    render(<GoalCheckBeat step={step} />);

    const outstanding = screen.getAllByRole("listitem");
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toHaveTextContent("Every school has a note");
  });
});

/**
 * Regression guard: a paused (`awaiting_input`) run resumes, so an
 * unattempted criterion must still read "not yet checked" — the same as a
 * running one — rather than the permanent "not checked" a genuinely
 * terminal status gets.
 */
describe("goal criterion honesty while awaiting input", () => {
  test("an unattempted criterion reads 'not yet checked' while paused on the student's answer", () => {
    const fixture = GOAL_MODE_FIXTURES.find(
      (item) => item.id === "goal-awaiting-input",
    )!;

    render(<GoalHeader detail={fixture.detail} />);
    fireEvent.click(screen.getByRole("button", { name: /done when/i }));

    expect(screen.getAllByText("not yet checked:").length).toBeGreaterThan(0);
    expect(screen.queryByText("not checked:")).not.toBeInTheDocument();
  });
});

/**
 * Regression guard (post-ship review 2026-09-16, finding A): an unrecognized
 * `status` reaches this code only via the unvalidated legacy-replay path
 * (`legacy-replay.ts` never shape-checks a `kind: "step"` segment's `data`),
 * and per the crash rule (§5.3) a non-null `status` only ever comes from a
 * genuine `phase: "final"` step — so an unrecognized one always means the
 * run has concluded. The verdict card only renders for that terminal case,
 * so it must never claim the run is still "Working".
 */
describe("goal status fallback honesty", () => {
  const unrecognizedDetail = {
    ...GOAL_CRITERION_HONESTY_FIXTURE.detail,
    status: "a_future_status_this_build_does_not_know" as unknown as GoalStatus,
  };

  test("the verdict card never renders 'Working' for an unrecognized terminal status", () => {
    render(<GoalVerdictCard detail={unrecognizedDetail} />);

    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    expect(screen.getByText("Status unknown")).toBeInTheDocument();
  });
});
