import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { CounselingMode, SkillCatalogEntry } from "@/api/chat/types";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";

import { ChatComposer } from "./ChatComposer";

const modes: CounselingMode[] = [
  {
    skillName: "focused-answer",
    displayName: "Focused Answer",
    description: "Clear, direct help.",
    order: 10,
    isDefault: true,
  },
  {
    skillName: "deep-research",
    displayName: "Deep Research",
    description: "Investigate carefully.",
    order: 20,
    isDefault: false,
  },
  {
    skillName: "guided-counselor",
    displayName: "Guided Counselor",
    description: "Work through it together.",
    order: 30,
    isDefault: false,
  },
];

const skills: SkillCatalogEntry[] = [
  {
    name: "school-comparison",
    displayName: "School comparison",
    description: "Compare schools side by side.",
  },
];

function renderComposer(
  overrides: Partial<Parameters<typeof ChatComposer>[0]> = {},
) {
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
  const view = render(<ChatComposer {...props} />);
  return { ...props, ...view };
}

describe("ChatComposer", () => {
  test("Enter sends the message", async () => {
    const props = renderComposer({ value: "Tell me about aid" });
    fireEvent.keyDown(screen.getByPlaceholderText("Message Counselle"), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith("Tell me about aid"),
    );
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

  test("uses the same stable composer shell as the AI landing page", () => {
    const { container } = renderComposer();

    const shell = container.querySelector("form > div");
    expect(shell).toHaveClass("min-h-28");
    expect(shell).toHaveClass("rounded-2xl");
    expect(shell).toContainElement(
      screen.getByRole("button", { name: /Sources:/ }),
    );
    expect(shell).toContainElement(
      screen.getByRole("button", { name: "Send" }),
    );
  });

  test("awaitingClarify swaps the placeholder", () => {
    renderComposer({ awaitingClarify: true });
    expect(
      screen.getByPlaceholderText(
        "Answer above, or reply in your own words...",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Answering the question above"),
    ).toBeInTheDocument();
  });

  test("awaitingClarify uses the compact reply shell", () => {
    const { container } = renderComposer({ awaitingClarify: true });

    const shell = container.querySelector("form > div");
    expect(shell).toHaveClass("min-h-0");
    expect(shell).not.toHaveClass("min-h-28");
    expect(screen.getByRole("button", { name: "Send" })).toHaveClass("size-8");
  });

  test("submit button becomes a stop control while submitting", () => {
    const props = renderComposer({ isSubmitting: true, value: "" });
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onStop).toHaveBeenCalled();
  });

  test("choosing a source from the menu patches only that key", () => {
    const props = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /Sources:/ }));
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Web search" }),
    );
    expect(props.onSourceConfigChange).toHaveBeenCalledWith({
      ...BUILT_IN_SOURCE_CONFIG,
      webSearch: false,
    });
  });

  test("choosing a response mode reports the selected mode", () => {
    const onResponseModeChange = vi.fn();
    renderComposer({
      onResponseModeChange,
      responseMode: "quick",
      responseModes: [
        {
          id: "quick",
          model: "google-vertex:gemini-3.5-flash",
          modelDisplayName: "Gemini 3.5 Flash",
          preview: false,
        },
        {
          id: "think",
          model: "google-vertex:gemini-3.1-pro-preview",
          modelDisplayName: "Gemini 3.1 Pro",
          preview: true,
        },
      ],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Response mode: Quick" }),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Think/ }));

    expect(onResponseModeChange).toHaveBeenCalledWith("think");
  });

  test("response mode and source controls are hidden while awaiting clarification", () => {
    renderComposer({ awaitingClarify: true, responseMode: "think" });

    expect(
      screen.queryByRole("button", { name: "Response mode: Think" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sources:/ }),
    ).not.toBeInTheDocument();
  });

  test("subreddit subset selection updates selectedSubreddits and preserves the legacy five-item order", () => {
    const props = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /Sources:/ }));

    const menu = screen.getByRole("menu");
    const communities = within(menu).getAllByRole("menuitemcheckbox").slice(3);
    expect(communities.map((community) => community.textContent)).toEqual([
      "ApplyingToCollege",
      "chanceme",
      "financialaid",
      "premed",
      "csMajors",
    ]);

    fireEvent.click(
      within(menu).getByRole("menuitemcheckbox", { name: "chanceme" }),
    );
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

  test("shows and changes the selected counseling mode", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    renderComposer({
      mode: modes[0],
      modes,
      onModeChange,
    });

    await user.click(
      screen.getByRole("button", { name: "Counseling mode: Focused Answer" }),
    );
    expect(await screen.findAllByRole("menuitemradio")).toHaveLength(3);
    await user.click(
      await screen.findByRole("menuitemradio", { name: /Deep Research/ }),
    );

    expect(onModeChange).toHaveBeenCalledWith(modes[1]);
  });

  test("hands off More specialized skills to the existing picker", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderComposer({
      maxSelectedSkills: 2,
      mode: modes[0],
      modes,
      onValueChange,
      skills,
      value: "Compare Duke",
    });

    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(12, 12);

    await user.click(
      screen.getByRole("button", { name: "Counseling mode: Focused Answer" }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: "More specialized skills...",
      }),
    );

    await waitFor(() =>
      expect(onValueChange).toHaveBeenCalledWith("Compare Duke @"),
    );
  });

  test("disables specialized skill browsing when task slots are full", async () => {
    const user = userEvent.setup();
    renderComposer({
      maxSelectedSkills: 1,
      mode: modes[0],
      modes,
      selectedSkills: ["school-comparison"],
      skills,
    });

    await user.click(
      screen.getByRole("button", { name: "Counseling mode: Focused Answer" }),
    );

    expect(
      await screen.findByRole("menuitem", {
        name: "Specialized skill limit reached",
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  test("falls back to the visible @ button when mode config is unavailable", () => {
    renderComposer({ maxSelectedSkills: 1, skills });

    expect(
      screen.getByRole("button", { name: "Add a skill (@)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Counseling mode:/ }),
    ).not.toBeInTheDocument();
  });

  test("hides the counseling mode during clarification answers", () => {
    renderComposer({
      awaitingClarify: true,
      maxSelectedSkills: 1,
      mode: modes[0],
      modes,
      skills,
    });

    expect(
      screen.queryByRole("button", {
        name: "Counseling mode: Focused Answer",
      }),
    ).not.toBeInTheDocument();
  });
});
