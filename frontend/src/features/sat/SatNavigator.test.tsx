import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import type { SatSessionRow } from "@/api/sat/types";

import { SatNavigator } from "./SatNavigator";

function row(overrides: Partial<SatSessionRow> = {}): SatSessionRow {
  return {
    id: "q1",
    score_band: 3,
    content_sha: "sha1",
    bookmarked: false,
    ever_correct: false,
    ever_incorrect: false,
    ...overrides,
  };
}

function stubViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SatNavigator", () => {
  it("opens the popover on desktop when the anchor is clicked", async () => {
    stubViewportWidth(1280);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <SatNavigator
          anchor={<Button>Question 1 of 2</Button>}
          currentIndex={0}
          getHistory={() => ({ everCorrect: false, everIncorrect: false })}
          getReveal={() => undefined}
          onOpenChange={setOpen}
          onSelect={onSelect}
          open={open}
          rows={[row({ id: "q1" }), row({ id: "q2" })]}
        />
      );
    }
    render(<Harness />);

    expect(screen.queryByText("2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Question 1 of 2" }));

    expect(await screen.findByRole("button", { name: /Question 2/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Question 2/i }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("opens the sheet at the mobile breakpoint when the anchor is clicked", async () => {
    stubViewportWidth(390);
    const user = userEvent.setup();
    const onSelect = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <SatNavigator
          anchor={<Button>Question 1 of 2</Button>}
          currentIndex={0}
          getHistory={() => ({ everCorrect: false, everIncorrect: false })}
          getReveal={() => undefined}
          onOpenChange={setOpen}
          onSelect={onSelect}
          open={open}
          rows={[row({ id: "q1" }), row({ id: "q2" })]}
        />
      );
    }
    render(<Harness />);

    expect(screen.queryByText(/Question bank|Go to a question|Questions/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Question 1 of 2" }));

    expect(await screen.findByRole("button", { name: /Question 2/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Question 2/i }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
