import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { PendingChangesReadout } from "@/features/essays/PendingChangesReadout";
import { countPendingChanges } from "@/features/essays/suggestions/suggestion-counts";

/*
 * The readout is the only claim on either essay surface that the model does not
 * author, so two things are worth pinning.
 *
 * Zero, because it is the case that matters. The agent has told a student it
 * proposed an edit on a turn where it made no tool call, and the pending-changes
 * bar unmounts at zero — so the false claim stood in a panel with nothing on it
 * to contradict it. A readout that hides when there is nothing to report is the
 * same bug again, which is why "None" is asserted as content, not as an absence.
 *
 * And the split, because the band sits inches from `SuggestionsBar`, which
 * states the *applicable* count. Counting the raw server rows here printed
 * "3 waiting" above the bar's "Counselle proposed 2 changes" — two different
 * numbers for one fact, on the surface whose whole job is being the number a
 * student can trust. Both now come out of `countPendingChanges`, so the test
 * runs the readout off exactly what the bar would say.
 */
describe("PendingChangesReadout", () => {
  test("says none when the essay has no suggestions", () => {
    render(
      <PendingChangesReadout announce counts={{ outdated: 0, waiting: 0 }} />,
    );

    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent("Proposed changes");
    expect(readout).toHaveTextContent("None");
  });

  test("states the applicable count the bar states, not the row count", () => {
    /* Three rows on the essay record; the middle one no longer anchors to the
     * document the student has since edited. The bar says "proposed 2". */
    const counts = countPendingChanges(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { from: 1, id: "a", stale: false },
        { from: null, id: "b", stale: true },
        { from: 9, id: "c", stale: false },
      ],
    );

    render(<PendingChangesReadout announce counts={counts} />);

    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent("2 waiting");
    expect(readout).toHaveTextContent("1 outdated");
    expect(readout).not.toHaveTextContent("3 waiting");
  });

  test("does not claim none while outdated changes are still on the page", () => {
    render(<PendingChangesReadout announce counts={{ outdated: 2, waiting: 0 }} />);

    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent("2 outdated");
    expect(readout).not.toHaveTextContent("None");
  });

  test("is not a live region unless it is the only channel", () => {
    render(<PendingChangesReadout counts={{ outdated: 0, waiting: 0 }} />);

    /* `SuggestionsBar` is announcing wherever this is not the sole surface, and
     * one fact announced twice in two grammars is worse than once. */
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("None")).toBeVisible();
  });
});
