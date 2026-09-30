import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Faq } from "./Faq";
afterEach(() => vi.restoreAllMocks());
const questionToggles = () =>
  screen
    .getAllByRole("button")
    .filter((button) => button.classList.contains("lp-faq-toggle"));
it("keeps aria-controls targets mounted and opens answers immediately from keyboard", () => {
  render(<Faq />);
  const toggles = questionToggles();
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
  const button = questionToggles()[1]!;
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
it("filters between students and schools and opens the first question of each", () => {
  render(<Faq />);
  const students = screen.getByRole("button", { name: "Students" });
  const schools = screen.getByRole("button", { name: "Schools & counselors" });
  expect(students).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", { name: "Why not just ask ChatGPT?" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.queryByRole("button", { name: "What can a counselor see?" }),
  ).toBeNull();
  fireEvent.click(schools);
  expect(schools).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", {
      name: "Does it replace our school counselors?",
    }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.queryByRole("button", { name: "Why not just ask ChatGPT?" }),
  ).toBeNull();
});
