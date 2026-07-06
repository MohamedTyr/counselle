import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";

import { ChatComposer } from "./ChatComposer";

function renderComposer(overrides: Partial<Parameters<typeof ChatComposer>[0]> = {}) {
  const props = {
    awaitingClarify: false,
    isSubmitting: false,
    onSourceConfigChange: vi.fn(),
    onStop: vi.fn(),
    onSubmit: vi.fn(),
    onValueChange: vi.fn(),
    sourceConfig: BUILT_IN_SOURCE_CONFIG,
    value: "",
    ...overrides,
  };
  render(<ChatComposer {...props} />);
  return props;
}

describe("ChatComposer", () => {
  test("Enter sends the message", async () => {
    const props = renderComposer({ value: "Tell me about aid" });
    fireEvent.keyDown(screen.getByPlaceholderText("Message Counselle"), { key: "Enter" });
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith("Tell me about aid"));
  });

  test("Shift+Enter does not send", () => {
    const props = renderComposer({ value: "Tell me about aid" });
    fireEvent.keyDown(screen.getByPlaceholderText("Message Counselle"), {
      key: "Enter",
      shiftKey: true,
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("IME composition guards Enter from sending", () => {
    const props = renderComposer({ value: "こんにちは" });
    const textarea = screen.getByPlaceholderText("Message Counselle");
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("typing calls onValueChange", () => {
    const props = renderComposer();
    fireEvent.change(screen.getByPlaceholderText("Message Counselle"), {
      target: { value: "New text" },
    });
    expect(props.onValueChange).toHaveBeenCalledWith("New text");
  });

  test("awaitingClarify swaps the placeholder", () => {
    renderComposer({ awaitingClarify: true });
    expect(screen.getByPlaceholderText("Pick one, or just type...")).toBeInTheDocument();
  });

  test("submit button becomes a stop control while submitting", () => {
    const props = renderComposer({ isSubmitting: true, value: "" });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onStop).toHaveBeenCalled();
  });

  test("clicking a source toggle patches only that key", () => {
    const props = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Web" }));
    expect(props.onSourceConfigChange).toHaveBeenCalledWith({
      ...BUILT_IN_SOURCE_CONFIG,
      webSearch: false,
    });
  });

  test("subreddit subset selection updates selectedSubreddits and preserves the legacy five-item order", () => {
    const props = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Choose subreddits" }));

    const menuHeading = screen.getByText("Communities");
    const menu = menuHeading.parentElement as HTMLElement;
    const chips = within(menu).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "ApplyingToCollege",
      "chanceme",
      "financialaid",
      "premed",
      "csMajors",
    ]);

    fireEvent.click(within(menu).getByText("chanceme"));
    expect(props.onSourceConfigChange).toHaveBeenCalledWith({
      ...BUILT_IN_SOURCE_CONFIG,
      selectedSubreddits: [
        "r/ApplyingToCollege",
        "r/financialaid",
        "r/premed",
        "r/csMajors",
      ],
    });
  });
});
