import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SatSessionSheet } from "@/features/sat/SatFilterRail";

describe("SatSessionSheet", () => {
  it("renders a Start button that is not width-gated, so it is reachable on phones", () => {
    const onStart = vi.fn();
    render(
      <SatSessionSheet
        bandTiers={[]}
        isRefetching={false}
        isStarting={false}
        onStart={onStart}
        onToggleBand={vi.fn()}
        onToggleTier={vi.fn()}
        questionCount={10}
        selectedBands={new Set<number>()}
        selectedSkillCount={2}
        startDisabledReason={null}
      />,
    );
    const start = screen.getByRole("button", { name: /start/i });
    expect(start.closest(".hidden")).toBeNull();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
