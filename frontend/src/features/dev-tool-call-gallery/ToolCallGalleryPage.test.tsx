import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ToolCallGalleryPage } from "./ToolCallGalleryPage";
import { GOAL_MODE_FIXTURES } from "./tool-call-fixtures";

/**
 * Smoke test for the gallery's "Goal mode" section (plans/goal-mode-plan.md
 * §6.5's gate: "the dev gallery renders all fixtures"). This confirms every
 * fixture mounts without throwing and appears once; it cannot verify the
 * 1440px/390px layout itself — that's a real-browser check jsdom has no
 * viewport to perform (§7.4).
 */
describe("ToolCallGalleryPage — goal mode", () => {
  test("renders exactly ten goal-mode fixtures", () => {
    expect(GOAL_MODE_FIXTURES.length).toBe(10);

    render(<ToolCallGalleryPage />);

    for (const fixture of GOAL_MODE_FIXTURES) {
      expect(screen.getByText(fixture.id)).toBeInTheDocument();
    }
  });

  test("renders the Goal region for every fixture, and the result region only for terminal ones with criteria", () => {
    render(<ToolCallGalleryPage />);

    const headers = screen.getAllByRole("region", { name: "Goal" });
    expect(headers).toHaveLength(GOAL_MODE_FIXTURES.length);

    const expectedCards = GOAL_MODE_FIXTURES.filter(
      (fixture) => fixture.detail.status !== null && fixture.detail.criteria.length > 0,
    ).length;
    const cards = screen.queryAllByRole("region", { name: "Goal result" });
    expect(cards).toHaveLength(expectedCards);
  });
});
