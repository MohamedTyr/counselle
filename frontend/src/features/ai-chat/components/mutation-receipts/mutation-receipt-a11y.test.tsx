import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { expect, describe, test } from "vitest";

import type { StepData } from "@/api/chat/types";

import { ToolStepBeat } from "../ToolWidgets";
import { TOOL_CALL_FIXTURES } from "@/features/dev-tool-call-gallery/tool-call-fixtures";

expect.extend(toHaveNoViolations);

/**
 * Automated accessibility smoke test (agent mutation receipts plan §16.2,
 * §16.3). axe-core in jsdom cannot verify real computed color contrast or
 * exercise a live screen reader — that half of §16.3 still needs a manual
 * pass in a real browser with NVDA/VoiceOver, which this repo's automation
 * can't perform. What this test DOES catch reliably: invalid/missing ARIA,
 * unlabeled interactive controls, redundant roles, and duplicate ids — real
 * defects a family widget could introduce without anyone noticing.
 */

const mutationFixtures: StepData[] = TOOL_CALL_FIXTURES.filter(
  (fixture) => fixture.step.detail?.mutation_contract === 1,
).map((fixture) => fixture.step);

describe("mutation receipt accessibility", () => {
  test.each(mutationFixtures.map((step) => [step.tool, step.label, step] as const))(
    "%s (%s) has no automatically-detectable a11y violations, collapsed",
    async (_tool, _label, step) => {
      const { container } = render(<ToolStepBeat step={step} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
  );

  test.each(
    mutationFixtures
      .filter((step) => step.status !== "start")
      .map((step) => [step.tool, step.label, step] as const),
  )(
    "%s (%s) has no automatically-detectable a11y violations, expanded",
    async (_tool, _label, step) => {
      const { container } = render(<ToolStepBeat step={step} />);
      const trigger = container.querySelector('[aria-expanded="false"]');
      if (trigger instanceof HTMLElement) {
        trigger.click();
      }
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
  );
});
