import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Faq } from "./Faq";
afterEach(() => vi.restoreAllMocks());
it("keeps aria-controls targets mounted and opens answers immediately from keyboard", () => {
  render(<Faq />);
  const toggles = screen.getAllByRole("button");
  toggles.forEach((button) =>
    expect(
      document.getElementById(button.getAttribute("aria-controls")!),
    ).not.toBeNull(),
  );
  fireEvent.click(toggles[1]!, { detail: 0 });
  expect(toggles[1]).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById("faq-answer-1")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  expect(document.getElementById("faq-answer-0")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(toggles[1]!.closest(".lp-faq-list")).toHaveAttribute(
    "data-pointer-motion",
    "false",
  );
});
it("enables pointer feedback and handles rapid open/close without stale answers", () => {
  render(<Faq />);
  const button = screen.getAllByRole("button")[1]!;
  fireEvent.click(button, { detail: 1 });
  expect(button.closest(".lp-faq-list")).toHaveAttribute(
    "data-pointer-motion",
    "true",
  );
  fireEvent.click(button, { detail: 1 });
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById("faq-answer-1")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});
